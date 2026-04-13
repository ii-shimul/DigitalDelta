import {
  Enum,
  Field,
  MapField,
  OneOf,
  Root,
  Type,
  type Message,
} from 'protobufjs';

import type { AppRole, LedgerAppendInput } from '../contracts';
import type { VectorClockMap } from '../crdt';

export type SyncTransportKind = 'bluetooth_le' | 'wifi_direct' | 'loopback';

export type SyncEnvelopeKind = 'HELLO' | 'DELTA' | 'ACK' | 'NACK';

export type SyncCursorWire = {
  lastKnownClock: VectorClockMap;
  lastEventId?: string;
};

export type MeshEventWire = {
  eventId: string;
  entityType: LedgerAppendInput['entityType'];
  entityId: string;
  eventType: LedgerAppendInput['eventType'];
  actorUserId: string;
  actorDeviceId: string;
  actorRole: AppRole;
  occurredAtMs: number;
  vectorClock: VectorClockMap;
  payloadType: string;
  payloadBlob?: Uint8Array;
  metadataJson: string;
};

export type SyncHelloWire = {
  schemaVersion: string;
  supportedCapabilities: string[];
  cursor: SyncCursorWire;
};

export type SyncDeltaWire = {
  fromCursor: SyncCursorWire;
  toCursor: SyncCursorWire;
  events: MeshEventWire[];
  estimatedBytes: number;
};

export type SyncAckWire = {
  envelopeId: string;
  mergedCursor: SyncCursorWire;
  acceptedEventIds: string[];
  missingEventIds: string[];
};

export type SyncNackWire = {
  envelopeId: string;
  code: number;
  detail: string;
};

export type SyncEnvelopeWire = {
  envelopeId: string;
  type: SyncEnvelopeKind;
  senderDeviceId: string;
  recipientDeviceId: string;
  sentAtMs: number;
  senderClock: VectorClockMap;
  signature?: Uint8Array;
  hello?: SyncHelloWire;
  delta?: SyncDeltaWire;
  ack?: SyncAckWire;
  nack?: SyncNackWire;
};

export type MeshForwardPacketWire = {
  packetId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  nextHopDeviceId?: string;
  ttlHops: number;
  hopCount: number;
  createdAtMs: number;
  senderMeshPublicKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  payloadHashHex: string;
};

const root = new Root();

const EnvelopeTypeEnum = new Enum('EnvelopeType', {
  HELLO: 1,
  DELTA: 2,
  ACK: 3,
  NACK: 4,
});

const VectorClockMessage = new Type('VectorClock').add(
  new MapField('entries', 1, 'string', 'uint64'),
);

const SyncCursorMessage = new Type('SyncCursor')
  .add(new Field('last_known_clock', 1, 'VectorClock'))
  .add(new Field('last_event_id', 2, 'string'));

const MeshEventMessage = new Type('MeshEvent')
  .add(new Field('event_id', 1, 'string'))
  .add(new Field('entity_type', 2, 'string'))
  .add(new Field('entity_id', 3, 'string'))
  .add(new Field('event_type', 4, 'string'))
  .add(new Field('actor_user_id', 5, 'string'))
  .add(new Field('actor_device_id', 6, 'string'))
  .add(new Field('actor_role', 7, 'string'))
  .add(new Field('occurred_at_ms', 8, 'uint64'))
  .add(new Field('vector_clock', 9, 'VectorClock'))
  .add(new Field('payload_type', 10, 'string'))
  .add(new Field('payload_blob', 11, 'bytes'))
  .add(new Field('metadata_json', 12, 'string'));

const SyncHelloMessage = new Type('SyncHello')
  .add(new Field('schema_version', 1, 'string'))
  .add(new Field('supported_capabilities', 2, 'string', 'repeated'))
  .add(new Field('cursor', 3, 'SyncCursor'));

const SyncDeltaMessage = new Type('SyncDelta')
  .add(new Field('from_cursor', 1, 'SyncCursor'))
  .add(new Field('to_cursor', 2, 'SyncCursor'))
  .add(new Field('events', 3, 'MeshEvent', 'repeated'))
  .add(new Field('estimated_bytes', 4, 'uint32'));

const SyncAckMessage = new Type('SyncAck')
  .add(new Field('envelope_id', 1, 'string'))
  .add(new Field('merged_cursor', 2, 'SyncCursor'))
  .add(new Field('accepted_event_ids', 3, 'string', 'repeated'))
  .add(new Field('missing_event_ids', 4, 'string', 'repeated'));

const SyncNackMessage = new Type('SyncNack')
  .add(new Field('envelope_id', 1, 'string'))
  .add(new Field('code', 2, 'uint32'))
  .add(new Field('detail', 3, 'string'));

const SyncEnvelopeMessage = new Type('SyncEnvelope')
  .add(new Field('envelope_id', 1, 'string'))
  .add(new Field('type', 2, 'EnvelopeType'))
  .add(new Field('sender_device_id', 3, 'string'))
  .add(new Field('recipient_device_id', 4, 'string'))
  .add(new Field('sent_at_ms', 5, 'uint64'))
  .add(new Field('sender_clock', 6, 'VectorClock'))
  .add(new Field('signature', 7, 'bytes'))
  .add(new Field('hello', 8, 'SyncHello'))
  .add(new Field('delta', 9, 'SyncDelta'))
  .add(new Field('ack', 10, 'SyncAck'))
  .add(new Field('nack', 11, 'SyncNack'))
  .add(new OneOf('body', ['hello', 'delta', 'ack', 'nack']));

const MeshForwardPacketMessage = new Type('MeshForwardPacket')
  .add(new Field('packet_id', 1, 'string'))
  .add(new Field('sender_device_id', 2, 'string'))
  .add(new Field('recipient_device_id', 3, 'string'))
  .add(new Field('next_hop_device_id', 4, 'string'))
  .add(new Field('ttl_hops', 5, 'uint32'))
  .add(new Field('hop_count', 6, 'uint32'))
  .add(new Field('created_at_ms', 7, 'uint64'))
  .add(new Field('sender_mesh_public_key', 8, 'bytes'))
  .add(new Field('nonce', 9, 'bytes'))
  .add(new Field('ciphertext', 10, 'bytes'))
  .add(new Field('payload_hash_hex', 11, 'string'));

root
  .define('digitaldelta.v1')
  .add(EnvelopeTypeEnum)
  .add(VectorClockMessage)
  .add(SyncCursorMessage)
  .add(MeshEventMessage)
  .add(SyncHelloMessage)
  .add(SyncDeltaMessage)
  .add(SyncAckMessage)
  .add(SyncNackMessage)
  .add(SyncEnvelopeMessage)
  .add(MeshForwardPacketMessage);

const EnvelopeTypeByName: Record<SyncEnvelopeKind, number> = {
  HELLO: 1,
  DELTA: 2,
  ACK: 3,
  NACK: 4,
};

const EnvelopeTypeById: Record<number, SyncEnvelopeKind> = {
  1: 'HELLO',
  2: 'DELTA',
  3: 'ACK',
  4: 'NACK',
};

export function encodeSyncEnvelope(envelope: SyncEnvelopeWire): Uint8Array {
  const payload = {
    envelope_id: envelope.envelopeId,
    type: EnvelopeTypeByName[envelope.type],
    sender_device_id: envelope.senderDeviceId,
    recipient_device_id: envelope.recipientDeviceId,
    sent_at_ms: envelope.sentAtMs,
    sender_clock: toProtoVectorClock(envelope.senderClock),
    signature: envelope.signature,
    hello: envelope.hello ? toProtoHello(envelope.hello) : undefined,
    delta: envelope.delta ? toProtoDelta(envelope.delta) : undefined,
    ack: envelope.ack ? toProtoAck(envelope.ack) : undefined,
    nack: envelope.nack ? toProtoNack(envelope.nack) : undefined,
  };

  const encoded = SyncEnvelopeMessage.encode(
    SyncEnvelopeMessage.create(payload),
  ).finish();

  return new Uint8Array(encoded);
}

export function decodeSyncEnvelope(encoded: Uint8Array): SyncEnvelopeWire {
  const decoded = SyncEnvelopeMessage.decode(encoded) as Message<{
    envelope_id?: string;
    type?: number | string;
    sender_device_id?: string;
    recipient_device_id?: string;
    sent_at_ms?: unknown;
    sender_clock?: unknown;
    signature?: Uint8Array;
    hello?: unknown;
    delta?: unknown;
    ack?: unknown;
    nack?: unknown;
  }>;
  const plain = SyncEnvelopeMessage.toObject(decoded, {
    longs: Number,
    defaults: false,
  }) as Record<string, unknown>;

  const numericType =
    typeof plain.type === 'number'
      ? plain.type
      : Number(plain.type ?? 0) || 0;

  return {
    envelopeId: asString(plain.envelope_id),
    type: EnvelopeTypeById[numericType] ?? 'NACK',
    senderDeviceId: asString(plain.sender_device_id),
    recipientDeviceId: asString(plain.recipient_device_id),
    sentAtMs: asNumber(plain.sent_at_ms),
    senderClock: fromProtoVectorClock(plain.sender_clock),
    signature: asBytes(plain.signature),
    hello: plain.hello ? fromProtoHello(plain.hello) : undefined,
    delta: plain.delta ? fromProtoDelta(plain.delta) : undefined,
    ack: plain.ack ? fromProtoAck(plain.ack) : undefined,
    nack: plain.nack ? fromProtoNack(plain.nack) : undefined,
  };
}

export function encodeMeshForwardPacket(
  packet: MeshForwardPacketWire,
): Uint8Array {
  const encoded = MeshForwardPacketMessage.encode(
    MeshForwardPacketMessage.create({
      packet_id: packet.packetId,
      sender_device_id: packet.senderDeviceId,
      recipient_device_id: packet.recipientDeviceId,
      next_hop_device_id: packet.nextHopDeviceId,
      ttl_hops: packet.ttlHops,
      hop_count: packet.hopCount,
      created_at_ms: packet.createdAtMs,
      sender_mesh_public_key: packet.senderMeshPublicKey,
      nonce: packet.nonce,
      ciphertext: packet.ciphertext,
      payload_hash_hex: packet.payloadHashHex,
    }),
  ).finish();

  return new Uint8Array(encoded);
}

export function decodeMeshForwardPacket(
  encoded: Uint8Array,
): MeshForwardPacketWire {
  const decoded = MeshForwardPacketMessage.decode(encoded) as Message<{
    packet_id?: string;
    sender_device_id?: string;
    recipient_device_id?: string;
    next_hop_device_id?: string;
    ttl_hops?: unknown;
    hop_count?: unknown;
    created_at_ms?: unknown;
    sender_mesh_public_key?: Uint8Array;
    nonce?: Uint8Array;
    ciphertext?: Uint8Array;
    payload_hash_hex?: string;
  }>;
  const plain = MeshForwardPacketMessage.toObject(decoded, {
    longs: Number,
    defaults: false,
  }) as Record<string, unknown>;

  return {
    packetId: asString(plain.packet_id),
    senderDeviceId: asString(plain.sender_device_id),
    recipientDeviceId: asString(plain.recipient_device_id),
    nextHopDeviceId: asOptionalString(plain.next_hop_device_id),
    ttlHops: asNumber(plain.ttl_hops),
    hopCount: asNumber(plain.hop_count),
    createdAtMs: asNumber(plain.created_at_ms),
    senderMeshPublicKey: asBytes(plain.sender_mesh_public_key) ?? new Uint8Array(),
    nonce: asBytes(plain.nonce) ?? new Uint8Array(),
    ciphertext: asBytes(plain.ciphertext) ?? new Uint8Array(),
    payloadHashHex: asString(plain.payload_hash_hex),
  };
}

function toProtoVectorClock(clock: VectorClockMap): {
  entries: Record<string, number>;
} {
  const entries: Record<string, number> = {};
  for (const [actorDeviceId, counter] of Object.entries(clock)) {
    if (!actorDeviceId) {
      continue;
    }
    entries[actorDeviceId] = Math.max(0, Math.floor(counter));
  }

  return { entries };
}

function fromProtoVectorClock(value: unknown): VectorClockMap {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const entriesCandidate = (value as { entries?: unknown }).entries;
  if (!entriesCandidate || typeof entriesCandidate !== 'object') {
    return {};
  }

  const output: VectorClockMap = {};
  for (const [actorDeviceId, counterValue] of Object.entries(
    entriesCandidate as Record<string, unknown>,
  )) {
    if (!actorDeviceId) {
      continue;
    }

    const counter = asNumber(counterValue);
    if (counter > 0) {
      output[actorDeviceId] = Math.floor(counter);
    }
  }

  return output;
}

function toProtoCursor(cursor: SyncCursorWire): {
  last_known_clock: { entries: Record<string, number> };
  last_event_id?: string;
} {
  return {
    last_known_clock: toProtoVectorClock(cursor.lastKnownClock),
    last_event_id: cursor.lastEventId,
  };
}

function fromProtoCursor(value: unknown): SyncCursorWire {
  const objectValue = asRecord(value);
  return {
    lastKnownClock: fromProtoVectorClock(objectValue.last_known_clock),
    lastEventId: asOptionalString(objectValue.last_event_id),
  };
}

function toProtoEvent(event: MeshEventWire): Record<string, unknown> {
  return {
    event_id: event.eventId,
    entity_type: event.entityType,
    entity_id: event.entityId,
    event_type: event.eventType,
    actor_user_id: event.actorUserId,
    actor_device_id: event.actorDeviceId,
    actor_role: event.actorRole,
    occurred_at_ms: event.occurredAtMs,
    vector_clock: toProtoVectorClock(event.vectorClock),
    payload_type: event.payloadType,
    payload_blob: event.payloadBlob,
    metadata_json: event.metadataJson,
  };
}

function fromProtoEvent(value: unknown): MeshEventWire {
  const objectValue = asRecord(value);

  return {
    eventId: asString(objectValue.event_id),
    entityType: asString(objectValue.entity_type) as MeshEventWire['entityType'],
    entityId: asString(objectValue.entity_id),
    eventType: asString(objectValue.event_type) as MeshEventWire['eventType'],
    actorUserId: asString(objectValue.actor_user_id),
    actorDeviceId: asString(objectValue.actor_device_id),
    actorRole: asString(objectValue.actor_role) as AppRole,
    occurredAtMs: asNumber(objectValue.occurred_at_ms),
    vectorClock: fromProtoVectorClock(objectValue.vector_clock),
    payloadType: asString(objectValue.payload_type),
    payloadBlob: asBytes(objectValue.payload_blob),
    metadataJson: asString(objectValue.metadata_json),
  };
}

function toProtoHello(hello: SyncHelloWire): Record<string, unknown> {
  return {
    schema_version: hello.schemaVersion,
    supported_capabilities: hello.supportedCapabilities,
    cursor: toProtoCursor(hello.cursor),
  };
}

function fromProtoHello(value: unknown): SyncHelloWire {
  const objectValue = asRecord(value);
  return {
    schemaVersion: asString(objectValue.schema_version),
    supportedCapabilities: asStringArray(objectValue.supported_capabilities),
    cursor: fromProtoCursor(objectValue.cursor),
  };
}

function toProtoDelta(delta: SyncDeltaWire): Record<string, unknown> {
  return {
    from_cursor: toProtoCursor(delta.fromCursor),
    to_cursor: toProtoCursor(delta.toCursor),
    events: delta.events.map(toProtoEvent),
    estimated_bytes: delta.estimatedBytes,
  };
}

function fromProtoDelta(value: unknown): SyncDeltaWire {
  const objectValue = asRecord(value);
  return {
    fromCursor: fromProtoCursor(objectValue.from_cursor),
    toCursor: fromProtoCursor(objectValue.to_cursor),
    events: asArray(objectValue.events).map(fromProtoEvent),
    estimatedBytes: asNumber(objectValue.estimated_bytes),
  };
}

function toProtoAck(ack: SyncAckWire): Record<string, unknown> {
  return {
    envelope_id: ack.envelopeId,
    merged_cursor: toProtoCursor(ack.mergedCursor),
    accepted_event_ids: ack.acceptedEventIds,
    missing_event_ids: ack.missingEventIds,
  };
}

function fromProtoAck(value: unknown): SyncAckWire {
  const objectValue = asRecord(value);
  return {
    envelopeId: asString(objectValue.envelope_id),
    mergedCursor: fromProtoCursor(objectValue.merged_cursor),
    acceptedEventIds: asStringArray(objectValue.accepted_event_ids),
    missingEventIds: asStringArray(objectValue.missing_event_ids),
  };
}

function toProtoNack(nack: SyncNackWire): Record<string, unknown> {
  return {
    envelope_id: nack.envelopeId,
    code: nack.code,
    detail: nack.detail,
  };
}

function fromProtoNack(value: unknown): SyncNackWire {
  const objectValue = asRecord(value);
  return {
    envelopeId: asString(objectValue.envelope_id),
    code: asNumber(objectValue.code),
    detail: asString(objectValue.detail),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === 'object' && 'toString' in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (Array.isArray(value)) {
    return new Uint8Array(value.filter(item => typeof item === 'number'));
  }

  return undefined;
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map(item => (typeof item === 'string' ? item : ''))
    .filter(item => item.length > 0);
}
