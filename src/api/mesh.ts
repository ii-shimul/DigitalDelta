import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import {
  computeMeshThrottleSimulation,
  createSQLiteMeshRelayService,
  decodeUtf8,
  encodeUtf8,
  type MeshThrottleSimulationResult,
  type MeshActor,
} from '../core';
import { getDatabase } from '../db';

import type { AuthenticatedSession } from './auth';
import { normalizeAuthRole } from './auth';
import type { LoginScreenData } from './screen-contracts';

type Scalar = SQLiteScalar | undefined;

export type MeshRoleCycleResult = {
  role: 'client' | 'relay';
  changed: boolean;
  relayScore: number;
  previousRole?: 'client' | 'relay';
  batteryPercent: number;
  signalStrength: number;
  nearbyPeerCount: number;
};

export type MeshStoreForwardCycleResult = {
  senderDeviceId: string;
  relayDeviceId: string;
  recipientDeviceId: string;
  packetId: string;
  senderDispatches: number;
  relayDispatches: number;
  delivered: boolean;
  relayStored: boolean;
  recipientAccepted: boolean;
  relayOnline: boolean;
  recipientOnline: boolean;
  deliveredMessage?: string;
};

export type MeshRelayLogItem = {
  action: string;
  status: string;
  detail?: string;
  occurredAtMs: number;
  packetId: string;
};

export type MeshRelaySnapshot = {
  devices: {
    senderDeviceId: string;
    relayDeviceId?: string;
    recipientDeviceId?: string;
  };
  queue: {
    senderPending: number;
    relayPending: number;
    recipientPending: number;
  };
  logs: {
    sender: MeshRelayLogItem[];
    relay: MeshRelayLogItem[];
    recipient: MeshRelayLogItem[];
  };
};

export type { MeshThrottleSimulationResult };

export class MeshApi {
  private readonly relayService = createSQLiteMeshRelayService();

  async evaluateNodeRole(input: {
    loginData: LoginScreenData;
    session?: AuthenticatedSession;
    batteryPercent?: number;
    signalStrength?: number;
    nearbyPeerCount?: number;
    proximityScore?: number;
  }): Promise<MeshRoleCycleResult> {
    const actor = buildActor(input.loginData, input.session);
    const inferred = await this.inferNodeMetrics(actor.deviceId);

    const batteryPercent = clampPercent(
      input.batteryPercent ?? inferred.batteryPercent,
    );
    const signalStrength = clampPercent(
      input.signalStrength ?? inferred.signalStrength,
    );
    const nearbyPeerCount = Math.max(
      0,
      input.nearbyPeerCount ?? inferred.nearbyPeerCount,
    );

    const result = await this.relayService.evaluateNodeRole({
      actor,
      batteryPercent,
      signalStrength,
      nearbyPeerCount,
      proximityScore: input.proximityScore,
    });

    return {
      role: result.role,
      changed: result.changed,
      relayScore: result.relayScore,
      previousRole: result.previousRole,
      batteryPercent,
      signalStrength,
      nearbyPeerCount,
    };
  }

  async runStoreForwardCycle(input: {
    loginData: LoginScreenData;
    session?: AuthenticatedSession;
    relayDeviceId?: string;
    recipientDeviceId?: string;
    relayOnline: boolean;
    recipientOnline: boolean;
    message?: string;
  }): Promise<MeshStoreForwardCycleResult> {
    const actor = buildActor(input.loginData, input.session);
    const peerSelection = await this.resolvePeerDevices(
      actor.deviceId,
      input.relayDeviceId,
      input.recipientDeviceId,
    );

    const enqueueResult = await this.relayService.queueEncryptedMessage({
      actor,
      recipientDeviceId: peerSelection.recipientDeviceId,
      nextHopDeviceId: peerSelection.relayDeviceId,
      ttlHops: 4,
      plaintext: encodeUtf8(
        input.message ??
          `Store-forward payload ${new Date().toISOString()} from ${actor.deviceId}`,
      ),
    });

    let senderDispatches = 0;
    let relayDispatches = 0;
    let delivered = false;
    let relayStored = false;
    let recipientAccepted = false;
    let deliveredMessage: string | undefined;

    if (input.relayOnline) {
      const senderDispatchResult = await this.relayService.dispatchQueuedPackets({
        ownerDeviceId: actor.deviceId,
        online: true,
      });
      senderDispatches = senderDispatchResult.sentCount;

      for (const dispatch of senderDispatchResult.dispatches) {
        if (dispatch.toPeerDeviceId !== peerSelection.relayDeviceId) {
          continue;
        }

        const relayReceive = await this.relayService.receiveForwardedPacket({
          receiverDeviceId: peerSelection.relayDeviceId,
          fromPeerDeviceId: actor.deviceId,
          packetBytes: dispatch.packetBytes,
        });
        relayStored = relayReceive.queuedForRelay;
      }

      if (input.recipientOnline) {
        const relayDispatchResult = await this.relayService.dispatchQueuedPackets({
          ownerDeviceId: peerSelection.relayDeviceId,
          online: true,
        });
        relayDispatches = relayDispatchResult.sentCount;

        for (const dispatch of relayDispatchResult.dispatches) {
          if (dispatch.toPeerDeviceId !== peerSelection.recipientDeviceId) {
            continue;
          }

          const recipientReceive = await this.relayService.receiveForwardedPacket({
            receiverDeviceId: peerSelection.recipientDeviceId,
            fromPeerDeviceId: peerSelection.relayDeviceId,
            packetBytes: dispatch.packetBytes,
          });

          recipientAccepted = true;
          delivered = recipientReceive.deliveredToRecipient;
          deliveredMessage = recipientReceive.plaintext
            ? decodeUtf8(recipientReceive.plaintext)
            : undefined;
        }
      }
    }

    return {
      senderDeviceId: actor.deviceId,
      relayDeviceId: peerSelection.relayDeviceId,
      recipientDeviceId: peerSelection.recipientDeviceId,
      packetId: enqueueResult.packetId,
      senderDispatches,
      relayDispatches,
      delivered,
      relayStored,
      recipientAccepted,
      relayOnline: input.relayOnline,
      recipientOnline: input.recipientOnline,
      deliveredMessage,
    };
  }

  async resumeRelayForwarding(input: {
    senderDeviceId?: string;
    relayDeviceId: string;
    recipientDeviceId?: string;
    recipientOnline: boolean;
  }): Promise<{
    senderDispatches: number;
    relayDeviceId: string;
    relayDispatches: number;
    delivered: boolean;
    deliveredMessage?: string;
  }> {
    let senderDispatches = 0;

    if (input.senderDeviceId) {
      const senderDispatchResult = await this.relayService.dispatchQueuedPackets({
        ownerDeviceId: input.senderDeviceId,
        online: true,
      });
      senderDispatches = senderDispatchResult.sentCount;

      for (const dispatch of senderDispatchResult.dispatches) {
        if (dispatch.toPeerDeviceId !== input.relayDeviceId) {
          continue;
        }

        await this.relayService.receiveForwardedPacket({
          receiverDeviceId: input.relayDeviceId,
          fromPeerDeviceId: input.senderDeviceId,
          packetBytes: dispatch.packetBytes,
        });
      }
    }

    const relayDispatchResult = await this.relayService.dispatchQueuedPackets({
      ownerDeviceId: input.relayDeviceId,
      online: true,
    });

    let delivered = false;
    let deliveredMessage: string | undefined;

    if (input.recipientOnline) {
      for (const dispatch of relayDispatchResult.dispatches) {
        if (
          input.recipientDeviceId &&
          dispatch.toPeerDeviceId !== input.recipientDeviceId
        ) {
          continue;
        }

        const recipientReceive = await this.relayService.receiveForwardedPacket({
          receiverDeviceId: dispatch.toPeerDeviceId,
          fromPeerDeviceId: input.relayDeviceId,
          packetBytes: dispatch.packetBytes,
        });

        if (recipientReceive.deliveredToRecipient) {
          delivered = true;
          deliveredMessage = recipientReceive.plaintext
            ? decodeUtf8(recipientReceive.plaintext)
            : undefined;
        }
      }
    }

    return {
      senderDispatches,
      relayDeviceId: input.relayDeviceId,
      relayDispatches: relayDispatchResult.sentCount,
      delivered,
      deliveredMessage,
    };
  }

  async getRelaySnapshot(input: {
    loginData: LoginScreenData;
    session?: AuthenticatedSession;
    relayDeviceId?: string;
    recipientDeviceId?: string;
    limit?: number;
  }): Promise<MeshRelaySnapshot> {
    const actor = buildActor(input.loginData, input.session);
    const peers = await this.resolvePeerDevices(
      actor.deviceId,
      input.relayDeviceId,
      input.recipientDeviceId,
    );

    const senderLogs = await this.relayService.listRecentRelayLogs(
      actor.deviceId,
      input.limit ?? 24,
    );
    const relayLogs = peers.relayDeviceId
      ? await this.relayService.listRecentRelayLogs(
          peers.relayDeviceId,
          input.limit ?? 24,
        )
      : [];
    const recipientLogs = peers.recipientDeviceId
      ? await this.relayService.listRecentRelayLogs(
          peers.recipientDeviceId,
          input.limit ?? 24,
        )
      : [];

    return {
      devices: {
        senderDeviceId: actor.deviceId,
        relayDeviceId: peers.relayDeviceId,
        recipientDeviceId: peers.recipientDeviceId,
      },
      queue: {
        senderPending: await this.getPendingQueueCount(actor.deviceId),
        relayPending: peers.relayDeviceId
          ? await this.getPendingQueueCount(peers.relayDeviceId)
          : 0,
        recipientPending: peers.recipientDeviceId
          ? await this.getPendingQueueCount(peers.recipientDeviceId)
          : 0,
      },
      logs: {
        sender: senderLogs,
        relay: relayLogs,
        recipient: recipientLogs,
      },
    };
  }

  async simulateBatteryAwareThrottle(input: {
    loginData: LoginScreenData;
    session?: AuthenticatedSession;
    batteryPercent?: number;
    signalStrength?: number;
    nearbyPeerCount?: number;
    stationary?: boolean;
    knownNodeDistanceMeters?: number;
    durationMinutes?: number;
    baseBroadcastIntervalMs?: number;
  }): Promise<MeshThrottleSimulationResult> {
    const actor = buildActor(input.loginData, input.session);
    const inferred = await this.inferNodeMetrics(actor.deviceId);
    const proximity = await this.inferKnownNodeProximity(input.loginData.userId);

    const batteryPercent = clampPercent(
      input.batteryPercent ?? inferred.batteryPercent,
    );
    const signalStrength = clampPercent(
      input.signalStrength ?? inferred.signalStrength,
    );
    const nearbyPeerCount = Math.max(
      0,
      input.nearbyPeerCount ?? inferred.nearbyPeerCount,
    );
    const stationary = Boolean(input.stationary);
    const knownNodeDistanceMeters = Math.max(
      0,
      input.knownNodeDistanceMeters ?? proximity.distanceMeters,
    );

    const simulation = computeMeshThrottleSimulation({
      durationMinutes: input.durationMinutes,
      baseBroadcastIntervalMs: input.baseBroadcastIntervalMs,
      batteryPercent,
      signalStrength,
      nearbyPeerCount,
      stationary,
      knownNodeDistanceMeters,
      nearestNodeId: proximity.nearestNodeId,
    });

    const db = await getDatabase();
    const row = await db.execute(
      `
        SELECT metadata_json AS metadataJson
        FROM mesh_node_state
        WHERE device_id = ?
        LIMIT 1
      `,
      [actor.deviceId],
    );
    const metadata = parseJsonRecord(row.rows[0]?.metadataJson);

    await db.execute(
      `
        INSERT OR REPLACE INTO mesh_node_state (
          device_id,
          current_role,
          relay_score,
          battery_percent,
          signal_strength,
          nearby_peer_count,
          last_role_changed_at_ms,
          last_evaluated_at_ms,
          metadata_json
        ) VALUES (?,
          COALESCE((SELECT current_role FROM mesh_node_state WHERE device_id = ?), 'client'),
          COALESCE((SELECT relay_score FROM mesh_node_state WHERE device_id = ?), 0),
          ?, ?, ?,
          (SELECT last_role_changed_at_ms FROM mesh_node_state WHERE device_id = ?),
          ?,
          ?
        )
      `,
      [
        actor.deviceId,
        actor.deviceId,
        actor.deviceId,
        batteryPercent,
        signalStrength,
        nearbyPeerCount,
        actor.deviceId,
        Date.now(),
        JSON.stringify({
          ...metadata,
          lastThrottleSimulation: simulation,
        }),
      ],
    );

    return simulation;
  }

  private async inferNodeMetrics(deviceId: string): Promise<{
    batteryPercent: number;
    signalStrength: number;
    nearbyPeerCount: number;
  }> {
    const db = await getDatabase();
    const metricsResult = await db.execute(
      `
        SELECT
          battery_percent AS batteryPercent,
          signal_strength AS signalStrength,
          nearby_peer_count AS nearbyPeerCount
        FROM mesh_node_state
        WHERE device_id = ?
        LIMIT 1
      `,
      [deviceId],
    );

    const peerCountResult = await db.execute(
      `
        SELECT COUNT(*) AS count
        FROM sync_peers
      `,
    );

    const row = metricsResult.rows[0];
    return {
      batteryPercent: clampPercent(asNumber(row?.batteryPercent) || 74),
      signalStrength: clampPercent(asNumber(row?.signalStrength) || 71),
      nearbyPeerCount: Math.max(
        0,
        asNumber(row?.nearbyPeerCount) || asNumber(peerCountResult.rows[0]?.count),
      ),
    };
  }

  private async inferKnownNodeProximity(userId: string): Promise<{
    nearestNodeId?: string;
    distanceMeters: number;
  }> {
    const db = await getDatabase();
    const vehicleResult = await db.execute(
      `
        SELECT
          latitude,
          longitude,
          current_node_id AS currentNodeId
        FROM vehicles
        WHERE metadata_json LIKE ?
        ORDER BY COALESCE(last_seen_at_ms, 0) DESC, vehicle_id ASC
        LIMIT 1
      `,
      [`%${userId}%`],
    );
    const vehicleRow = vehicleResult.rows[0];
    const currentNodeId = asOptionalString(vehicleRow?.currentNodeId);

    if (currentNodeId) {
      return {
        nearestNodeId: currentNodeId,
        distanceMeters: 0,
      };
    }

    const latitude = asOptionalNumber(vehicleRow?.latitude);
    const longitude = asOptionalNumber(vehicleRow?.longitude);

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return {
        distanceMeters: 750,
      };
    }

    const nodesResult = await db.execute(
      `
        SELECT
          node_id AS nodeId,
          latitude,
          longitude
        FROM network_nodes
        WHERE is_active = 1
      `,
    );

    let nearestNodeId: string | undefined;
    let nearestDistanceMeters = Number.POSITIVE_INFINITY;

    for (const row of nodesResult.rows) {
      const nodeLatitude = asOptionalNumber(row.latitude);
      const nodeLongitude = asOptionalNumber(row.longitude);

      if (typeof nodeLatitude !== 'number' || typeof nodeLongitude !== 'number') {
        continue;
      }

      const meters = haversineMeters(
        latitude,
        longitude,
        nodeLatitude,
        nodeLongitude,
      );
      if (meters < nearestDistanceMeters) {
        nearestDistanceMeters = meters;
        nearestNodeId = asOptionalString(row.nodeId);
      }
    }

    if (!Number.isFinite(nearestDistanceMeters)) {
      return {
        distanceMeters: 750,
      };
    }

    return {
      nearestNodeId,
      distanceMeters: nearestDistanceMeters,
    };
  }

  private async resolvePeerDevices(
    localDeviceId: string,
    requestedRelayDeviceId?: string,
    requestedRecipientDeviceId?: string,
  ): Promise<{
    relayDeviceId: string;
    recipientDeviceId: string;
  }> {
    const db = await getDatabase();
    const peersResult = await db.execute(
      `
        SELECT peer_device_id AS peerDeviceId
        FROM sync_peers
        WHERE peer_device_id != ?
        ORDER BY COALESCE(last_seen_at_ms, 0) DESC, peer_device_id ASC
      `,
      [localDeviceId],
    );

    const peers = peersResult.rows
      .map(row => asOptionalString(row.peerDeviceId))
      .filter((value): value is string => Boolean(value));

    const relayDeviceId = requestedRelayDeviceId ?? peers[0] ?? 'DEV-BRAVO-02';
    let recipientDeviceId =
      requestedRecipientDeviceId ??
      peers.find(peerId => peerId !== relayDeviceId) ??
      peers[1] ??
      'DEV-CHARLIE-03';

    if (recipientDeviceId === relayDeviceId) {
      recipientDeviceId =
        relayDeviceId === 'DEV-CHARLIE-03' ? 'DEV-BRAVO-02' : 'DEV-CHARLIE-03';
    }

    return {
      relayDeviceId,
      recipientDeviceId,
    };
  }

  private async getPendingQueueCount(ownerDeviceId: string): Promise<number> {
    const db = await getDatabase();
    const result = await db.execute(
      `
        SELECT COUNT(*) AS count
        FROM mesh_store_queue
        WHERE owner_device_id = ?
          AND status IN ('stored', 'retry')
      `,
      [ownerDeviceId],
    );

    return asNumber(result.rows[0]?.count);
  }
}

function buildActor(
  loginData: LoginScreenData,
  session?: AuthenticatedSession,
): MeshActor {
  if (session) {
    return {
      userId: session.userId,
      deviceId: session.deviceId,
      role: session.activeRole,
    };
  }

  return {
    userId: loginData.userId,
    deviceId: loginData.deviceId,
    role: normalizeAuthRole(loginData.primaryRole) ?? 'FIELD_VOLUNTEER',
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function haversineMeters(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;

  const latitudeDelta = toRadians(toLat - fromLat);
  const longitudeDelta = toRadians(toLon - fromLon);

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseJsonRecord(value: Scalar | unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asOptionalNumber(value: Scalar | unknown): number | undefined {
  if (value === null || typeof value === 'undefined') {
    return undefined;
  }

  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asOptionalString(value: Scalar | unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: Scalar | unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
