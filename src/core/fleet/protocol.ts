import { Enum, Field, Root, Type, type Message } from 'protobufjs';

import type { RouteMode } from '../contracts';

export type FleetHandoffStatus =
  | 'pending'
  | 'confirmed'
  | 'ownership_transferred'
  | 'failed';

export type FleetHandoffEventWire = {
  handoffId: string;
  deliveryId: string;
  sourceVehicleId: string;
  sourceVehicleType: RouteMode;
  targetVehicleId: string;
  targetVehicleType: RouteMode;
  rendezvousLatitude: number;
  rendezvousLongitude: number;
  cargoIds: string[];
  receiptId?: string;
  status: FleetHandoffStatus;
  occurredAtMs: number;
};

const root = new Root();

const VehicleTypeEnum = new Enum('VehicleType', {
  VEHICLE_TYPE_UNSPECIFIED: 0,
  VEHICLE_TYPE_TRUCK: 1,
  VEHICLE_TYPE_BOAT: 2,
  VEHICLE_TYPE_DRONE: 3,
});

const HandoffStatusEnum = new Enum('HandoffStatus', {
  HANDOFF_STATUS_UNSPECIFIED: 0,
  HANDOFF_STATUS_PROPOSED: 1,
  HANDOFF_STATUS_RENDEZVOUS_CONFIRMED: 2,
  HANDOFF_STATUS_TRANSFERRED: 3,
  HANDOFF_STATUS_ACKNOWLEDGED: 4,
  HANDOFF_STATUS_FAILED: 5,
});

const GeoPointMessage = new Type('GeoPoint')
  .add(new Field('latitude', 1, 'double'))
  .add(new Field('longitude', 2, 'double'));

const HandoffEventMessage = new Type('HandoffEvent')
  .add(new Field('handoff_id', 1, 'string'))
  .add(new Field('delivery_id', 2, 'string'))
  .add(new Field('source_vehicle_id', 3, 'string'))
  .add(new Field('source_vehicle_type', 4, 'VehicleType'))
  .add(new Field('target_vehicle_id', 5, 'string'))
  .add(new Field('target_vehicle_type', 6, 'VehicleType'))
  .add(new Field('rendezvous_point', 7, 'GeoPoint'))
  .add(new Field('cargo_ids', 8, 'string', 'repeated'))
  .add(new Field('status', 10, 'HandoffStatus'))
  .add(new Field('occurred_at_ms', 11, 'uint64'));

root
  .define('digitaldelta.v1')
  .add(VehicleTypeEnum)
  .add(HandoffStatusEnum)
  .add(GeoPointMessage)
  .add(HandoffEventMessage);

const vehicleTypeToProto: Record<RouteMode, number> = {
  truck: 1,
  speedboat: 2,
  drone: 3,
};

const vehicleTypeFromProto: Record<number, RouteMode> = {
  1: 'truck',
  2: 'speedboat',
  3: 'drone',
};

const statusToProto: Record<FleetHandoffStatus, number> = {
  pending: 1,
  confirmed: 2,
  ownership_transferred: 3,
  failed: 5,
};

const statusFromProto: Record<number, FleetHandoffStatus> = {
  1: 'pending',
  2: 'confirmed',
  3: 'ownership_transferred',
  5: 'failed',
};

export function encodeFleetHandoffEvent(event: FleetHandoffEventWire): Uint8Array {
  const encoded = HandoffEventMessage.encode(
    HandoffEventMessage.create({
      handoff_id: event.handoffId,
      delivery_id: event.deliveryId,
      source_vehicle_id: event.sourceVehicleId,
      source_vehicle_type: vehicleTypeToProto[event.sourceVehicleType],
      target_vehicle_id: event.targetVehicleId,
      target_vehicle_type: vehicleTypeToProto[event.targetVehicleType],
      rendezvous_point: {
        latitude: event.rendezvousLatitude,
        longitude: event.rendezvousLongitude,
      },
      cargo_ids: event.cargoIds,
      status: statusToProto[event.status],
      occurred_at_ms: event.occurredAtMs,
    }),
  ).finish();

  return new Uint8Array(encoded);
}

export function decodeFleetHandoffEvent(encoded: Uint8Array): FleetHandoffEventWire {
  const decoded = HandoffEventMessage.decode(encoded) as Message<{
    handoff_id?: string;
    delivery_id?: string;
    source_vehicle_id?: string;
    source_vehicle_type?: number | string;
    target_vehicle_id?: string;
    target_vehicle_type?: number | string;
    rendezvous_point?: {
      latitude?: number;
      longitude?: number;
    };
    cargo_ids?: string[];
    status?: number | string;
    occurred_at_ms?: unknown;
  }>;

  const plain = HandoffEventMessage.toObject(decoded, {
    longs: Number,
    defaults: false,
  }) as Record<string, unknown>;

  const sourceTypeId =
    typeof plain.source_vehicle_type === 'number'
      ? plain.source_vehicle_type
      : Number(plain.source_vehicle_type ?? 0) || 0;
  const targetTypeId =
    typeof plain.target_vehicle_type === 'number'
      ? plain.target_vehicle_type
      : Number(plain.target_vehicle_type ?? 0) || 0;
  const statusId =
    typeof plain.status === 'number'
      ? plain.status
      : Number(plain.status ?? 0) || 0;

  const rendezvous = asRecord(plain.rendezvous_point);

  return {
    handoffId: asString(plain.handoff_id),
    deliveryId: asString(plain.delivery_id),
    sourceVehicleId: asString(plain.source_vehicle_id),
    sourceVehicleType: vehicleTypeFromProto[sourceTypeId] ?? 'speedboat',
    targetVehicleId: asString(plain.target_vehicle_id),
    targetVehicleType: vehicleTypeFromProto[targetTypeId] ?? 'drone',
    rendezvousLatitude: asNumber(rendezvous.latitude),
    rendezvousLongitude: asNumber(rendezvous.longitude),
    cargoIds: Array.isArray(plain.cargo_ids)
      ? plain.cargo_ids.filter((entry): entry is string => typeof entry === 'string')
      : [],
    status: statusFromProto[statusId] ?? 'pending',
    occurredAtMs: asNumber(plain.occurred_at_ms),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
