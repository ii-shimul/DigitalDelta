package com.digitaldelta

import android.bluetooth.*
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * BleGattServerModule
 *
 * Native Android GATT server that makes this device act as a BLE Peripheral,
 * enabling two-way BLE sync with any DigitalDelta Central (react-native-ble-plx).
 *
 * GATT Service:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *
 * Characteristics:
 *   CLOCK  (6E400002) – READ   : returns current vector-clock JSON bytes
 *   DELTA  (6E400003) – WRITE  : Central writes its SyncDelta protobuf chunks here
 *   NOTIFY (6E400004) – NOTIFY : Peripheral pushes its SyncDelta to Central
 *
 * JS API (exposed via NativeModule):
 *   startServer(vectorClockJson: string)  → starts GATT server + BLE advertising
 *   stopServer()                          → tears down GATT server + advertising
 *   updateVectorClock(json: string)       → updates the value returned on CLOCK reads
 *   sendDelta(base64: string)             → notifies all connected Centrals with data
 *
 * JS Events emitted (via RCTDeviceEventEmitter):
 *   BleGattClientConnected   { deviceAddress: string }
 *   BleGattClientDisconnected{ deviceAddress: string }
 *   BleGattDeltaReceived     { base64: string, deviceAddress: string }
 */
class BleGattServerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "BleGattServerModule"

        val SERVICE_UUID: UUID =
            UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
        val CLOCK_CHAR_UUID: UUID =
            UUID.fromString("6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
        val DELTA_CHAR_UUID: UUID =
            UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")
        val NOTIFY_CHAR_UUID: UUID =
            UUID.fromString("6E400004-B5A3-F393-E0A9-E50E24DCCA9E")

        /** Maximum bytes accepted per sync exchange (M2.4 requirement). */
        private const val MAX_SYNC_BYTES = 10_240 // 10 KB

        /** BLE CCC descriptor UUID (required for notifications). */
        val CCC_DESCRIPTOR_UUID: UUID =
            UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")
    }

    // ── State ─────────────────────────────────────────────────────────────

    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null

    /** Rolling accumulator for chunked DELTA writes from a Central. */
    private val deltaBuffer = ConcurrentLinkedQueue<Byte>()

    /** The value returned when a Central reads CLOCK_CHAR. */
    @Volatile
    private var clockJsonBytes: ByteArray = "{}".toByteArray(Charsets.UTF_8)

    /** The SyncDelta bytes we will notify connected Centrals with. */
    @Volatile
    private var pendingNotifyBytes: ByteArray? = null

    private val isRunning = AtomicBoolean(false)

    /** Set of currently connected Central device addresses. */
    private val connectedCentrals = mutableSetOf<BluetoothDevice>()

    // ── ReactContextBaseJavaModule ─────────────────────────────────────────

    override fun getName(): String = "BleGattServer"

    // ── JS-accessible methods ──────────────────────────────────────────────

    /**
     * Start the GATT server and BLE advertising.
     *
     * @param vectorClockJson  JSON string of our current vector clock, e.g. {"device-A":3}
     */
    @ReactMethod
    fun startServer(vectorClockJson: String, promise: Promise) {
        if (isRunning.get()) {
            promise.resolve(null)
            return
        }
        try {
            clockJsonBytes = vectorClockJson.toByteArray(Charsets.UTF_8)
            val adapter = getBluetoothAdapter()
            if (adapter == null || !adapter.isEnabled) {
                promise.reject("BLE_NOT_READY", "Bluetooth is off or unavailable")
                return
            }
            openGattServer(adapter)
            startAdvertising(adapter)
            isRunning.set(true)
            Log.i(TAG, "GATT server started, advertising $SERVICE_UUID")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "startServer failed: ${e.message}", e)
            promise.reject("START_FAILED", e.message, e)
        }
    }

    /** Stop the GATT server and BLE advertising. */
    @ReactMethod
    fun stopServer(promise: Promise) {
        try {
            stopAdvertising()
            gattServer?.close()
            gattServer = null
            connectedCentrals.clear()
            deltaBuffer.clear()
            isRunning.set(false)
            Log.i(TAG, "GATT server stopped")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_FAILED", e.message, e)
        }
    }

    /** Update the vector clock value returned to Centrals reading CLOCK_CHAR. */
    @ReactMethod
    fun updateVectorClock(vectorClockJson: String, promise: Promise) {
        clockJsonBytes = vectorClockJson.toByteArray(Charsets.UTF_8)
        promise.resolve(null)
    }

    /**
     * Queue a SyncDelta notification to all connected Centrals.
     * @param base64 Base64-encoded protobuf SyncDelta bytes.
     */
    @ReactMethod
    fun sendDelta(base64: String, promise: Promise) {
        val bytes = try {
            Base64.decode(base64, Base64.NO_WRAP)
        } catch (e: Exception) {
            promise.reject("INVALID_BASE64", e.message, e)
            return
        }
        if (bytes.size > MAX_SYNC_BYTES) {
            promise.reject("DELTA_TOO_LARGE", "Delta exceeds 10 KB limit")
            return
        }
        pendingNotifyBytes = bytes
        notifyAllCentrals(bytes)
        promise.resolve(null)
    }

    // ── GATT server setup ──────────────────────────────────────────────────

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        val bm = reactApplicationContext
            .getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return bm?.adapter
    }

    private fun openGattServer(adapter: BluetoothAdapter) {
        val bm = reactApplicationContext
            .getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager

        gattServer = bm.openGattServer(reactApplicationContext, gattServerCallback)
            ?: throw IllegalStateException("BluetoothManager.openGattServer returned null")

        // Build service with three characteristics
        val service = BluetoothGattService(
            SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY,
        )

        // CLOCK char – readable, no auth
        val clockChar = BluetoothGattCharacteristic(
            CLOCK_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ,
        )
        service.addCharacteristic(clockChar)

        // DELTA char – writable with or without response, no auth
        val deltaChar = BluetoothGattCharacteristic(
            DELTA_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        service.addCharacteristic(deltaChar)

        // NOTIFY char – readable + notify; Central reads our response delta
        val notifyChar = BluetoothGattCharacteristic(
            NOTIFY_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ,
        )
        val cccDescriptor = BluetoothGattDescriptor(
            CCC_DESCRIPTOR_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        )
        notifyChar.addDescriptor(cccDescriptor)
        service.addCharacteristic(notifyChar)

        gattServer!!.addService(service)
    }

    // ── BLE advertising ────────────────────────────────────────────────────

    private fun startAdvertising(adapter: BluetoothAdapter) {
        advertiser = adapter.bluetoothLeAdvertiser
            ?: throw IllegalStateException("Device does not support BLE advertising")

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setConnectable(true)
            .setTimeout(0) // advertise indefinitely
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
                Log.i(TAG, "BLE advertising started")
            }

            override fun onStartFailure(errorCode: Int) {
                Log.e(TAG, "BLE advertising failed, errorCode=$errorCode")
                emitEvent(
                    "BleGattAdvertiseError",
                    Arguments.createMap().apply { putInt("errorCode", errorCode) },
                )
            }
        }
        advertiser!!.startAdvertising(settings, data, advertiseCallback!!)
    }

    private fun stopAdvertising() {
        advertiseCallback?.let { advertiser?.stopAdvertising(it) }
        advertiseCallback = null
        advertiser = null
    }

    // ── GATT server callback ───────────────────────────────────────────────

    private val gattServerCallback = object : BluetoothGattServerCallback() {

        override fun onConnectionStateChange(
            device: BluetoothDevice,
            status: Int,
            newState: Int,
        ) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedCentrals.add(device)
                    Log.i(TAG, "Central connected: ${device.address}")
                    emitEvent(
                        "BleGattClientConnected",
                        Arguments.createMap().apply {
                            putString("deviceAddress", device.address)
                        },
                    )
                    // If we have a delta queued, notify the newly connected Central
                    pendingNotifyBytes?.let { notifyDevice(device, it) }
                }

                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedCentrals.remove(device)
                    Log.i(TAG, "Central disconnected: ${device.address}")
                    emitEvent(
                        "BleGattClientDisconnected",
                        Arguments.createMap().apply {
                            putString("deviceAddress", device.address)
                        },
                    )
                }
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic,
        ) {
            if (characteristic.uuid == CLOCK_CHAR_UUID) {
                val slice = if (offset < clockJsonBytes.size) {
                    clockJsonBytes.copyOfRange(offset, clockJsonBytes.size)
                } else {
                    ByteArray(0)
                }
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    offset,
                    slice,
                )
            } else if (characteristic.uuid == NOTIFY_CHAR_UUID) {
                // Central reads NOTIFY char directly (react-native-ble-plx uses reads)
                val bytes = pendingNotifyBytes ?: ByteArray(0)
                val slice = if (offset < bytes.size) {
                    bytes.copyOfRange(offset, bytes.size)
                } else {
                    ByteArray(0)
                }
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    offset,
                    slice,
                )
            } else {
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_READ_NOT_PERMITTED,
                    offset,
                    null,
                )
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            if (characteristic.uuid != DELTA_CHAR_UUID) {
                if (responseNeeded) {
                    gattServer?.sendResponse(
                        device,
                        requestId,
                        BluetoothGatt.GATT_WRITE_NOT_PERMITTED,
                        offset,
                        null,
                    )
                }
                return
            }

            value?.forEach { deltaBuffer.add(it) }

            if (responseNeeded) {
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    offset,
                    null,
                )
            }

            // A zero-length write signals end of chunked transmission
            if (value == null || value.isEmpty()) {
                flushDeltaBuffer(device)
            } else if (deltaBuffer.size >= MAX_SYNC_BYTES) {
                // Safety: flush / reject if buffer overflows
                deltaBuffer.clear()
                Log.w(TAG, "Delta buffer overflow from ${device.address}, discarded")
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            // Central subscribing/unsubscribing from notifications
            if (responseNeeded) {
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    offset,
                    null,
                )
            }
        }

        override fun onExecuteWrite(
            device: BluetoothDevice,
            requestId: Int,
            execute: Boolean,
        ) {
            if (execute) {
                flushDeltaBuffer(device)
            } else {
                deltaBuffer.clear()
            }
            gattServer?.sendResponse(
                device,
                requestId,
                BluetoothGatt.GATT_SUCCESS,
                0,
                null,
            )
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /** Drain the delta accumulator and emit a JS event. */
    private fun flushDeltaBuffer(device: BluetoothDevice) {
        if (deltaBuffer.isEmpty()) return
        val bytes = ByteArray(deltaBuffer.size)
        var i = 0
        while (deltaBuffer.isNotEmpty()) {
            bytes[i++] = deltaBuffer.poll() ?: 0
        }
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        Log.i(TAG, "Delta received from ${device.address}: ${bytes.size} bytes")
        emitEvent(
            "BleGattDeltaReceived",
            Arguments.createMap().apply {
                putString("base64", b64)
                putString("deviceAddress", device.address)
            },
        )
    }

    /** Send a notification to one connected Central device. */
    private fun notifyDevice(device: BluetoothDevice, bytes: ByteArray) {
        val server = gattServer ?: return
        val service = server.getService(SERVICE_UUID) ?: return
        val notifyChar = service.getCharacteristic(NOTIFY_CHAR_UUID) ?: return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            server.notifyCharacteristicChanged(device, notifyChar, false, bytes)
        } else {
            @Suppress("DEPRECATION")
            notifyChar.value = bytes
            @Suppress("DEPRECATION")
            server.notifyCharacteristicChanged(device, notifyChar, false)
        }
    }

    /** Notify all currently connected Centrals. */
    private fun notifyAllCentrals(bytes: ByteArray) {
        connectedCentrals.forEach { notifyDevice(it, bytes) }
    }

    /** Emit an event to the React JS thread. */
    private fun emitEvent(eventName: String, params: WritableMap?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
