import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type { DatabaseHandle } from '../../db';
import { getDatabase } from '../../db';
import type { AppRole, LedgerAppendInput } from '../contracts';
import {
  compareVectorClocks,
  deserializeVectorClock,
  mergeVectorClocks,
  tickVectorClock,
  type VectorClockMap,
} from '../crdt';
import { DIGITAL_DELTA_SCHEMA_VERSION, SYNC_CAPABILITIES } from '../event-types';
import { encodeUtf8 } from '../auth/crypto';
import {
  createSQLiteLedgerService,
  type AuthLedgerService,
} from '../auth/ledger-service';

import { mergeInventoryLwwRegister } from './inventory-lww-register';
import {
  decodeSyncEnvelope,
  encodeSyncEnvelope,
  type MeshEventWire,
  type SyncCursorWire,
  type SyncEnvelopeWire,
  type SyncTransportKind,
} from './protocol';

type Scalar = SQLiteScalar | undefined;

export type MeshSyncActor = {
  userId: string;
  deviceId: string;
  role: AppRole;
  displayName?: string;
};

export type QueueDeltaInput = {
  peerDeviceId: string;
  actor: MeshSyncActor;
  transport?: SyncTransportKind;
  maxEnvelopeBytes?: number;
};

export type QueueDeltaResult = {
  envelopeId: string;
  envelopeBytes: Uint8Array;
  envelopeSizeBytes: number;
  exportedEventCount: number;
  estimatedBytes: number;
  toCursor: SyncCursorWire;
};

export type ProcessIncomingInput = {
  envelopeBytes: Uint8Array;
  receiver: MeshSyncActor;
  transport: SyncTransportKind;
};

export type ProcessIncomingResult = {
  type: SyncEnvelopeWire['type'];
  envelopeId: string;
  acceptedEventIds: string[];
  missingEventIds: string[];
  importedEventCount: number;
  conflictsDetected: number;
  ackEnvelopeBytes?: Uint8Array;
};

export type SimulatePeerDeltaInput = {
  peerDeviceId: string;
  recipientDeviceId: string;
  inventoryItemId: string;
  quantity: number;
  unit?: string;
  itemName?: string;
  category?: string;
  storageNodeId?: string;
  status?: string;
  occurredAtMs?: number;
};

const DEFAULT_MAX_ENVELOPE_BYTES = 9_500;

export function createSQLiteMeshSyncService(
  dbProvider?: () => Promise<DatabaseHandle>,
): SQLiteMeshSyncService {
  const resolvedDbProvider = dbProvider ?? getDatabase;
  const ledgerService = createSQLiteLedgerService(resolvedDbProvider);

  return new SQLiteMeshSyncService(resolvedDbProvider, ledgerService);
}

export class SQLiteMeshSyncService {
  constructor(
    private readonly dbProvider: () => Promise<DatabaseHandle>,
    private readonly ledgerService: AuthLedgerService,
  ) {}

  async queueDeltaForPeer(input: QueueDeltaInput): Promise<QueueDeltaResult> {
    const db = await this.dbProvider();
    const nowMs = Date.now();
    const transport = input.transport ?? 'bluetooth_le';
    const maxEnvelopeBytes = input.maxEnvelopeBytes ?? DEFAULT_MAX_ENVELOPE_BYTES;
    const fromCursor = await this.getPeerCursor(input.peerDeviceId);

    const deltaEvents = await this.ledgerService.getDeltaSince({
      peerDeviceId: input.peerDeviceId,
      lastKnownClock: fromCursor.lastKnownClock,
      lastEventId: fromCursor.lastEventId,
    });

    const envelopeId = createIdentifier('env');
    const normalizedEvents = deltaEvents.map(event => mapLedgerEventToWire(event));
    let selectedEvents = [...normalizedEvents];

    let deltaEnvelope = this.buildDeltaEnvelope({
      envelopeId,
      senderDeviceId: input.actor.deviceId,
      recipientDeviceId: input.peerDeviceId,
      fromCursor,
      events: selectedEvents,
      sentAtMs: nowMs,
      senderClock: await this.ledgerService.getLatestVectorClockForDevice(
        input.actor.deviceId,
      ),
    });
    let encodedEnvelope = encodeSyncEnvelope(deltaEnvelope);

    while (encodedEnvelope.byteLength > maxEnvelopeBytes && selectedEvents.length > 1) {
      selectedEvents = selectedEvents.slice(0, selectedEvents.length - 1);
      deltaEnvelope = this.buildDeltaEnvelope({
        envelopeId,
        senderDeviceId: input.actor.deviceId,
        recipientDeviceId: input.peerDeviceId,
        fromCursor,
        events: selectedEvents,
        sentAtMs: nowMs,
        senderClock: await this.ledgerService.getLatestVectorClockForDevice(
          input.actor.deviceId,
        ),
      });
      encodedEnvelope = encodeSyncEnvelope(deltaEnvelope);
    }

    await db.execute(
      `
        INSERT OR REPLACE INTO sync_outbox (
          envelope_id,
          recipient_device_id,
          transport,
          status,
          dedup_key,
          ttl_hops,
          hop_count,
          requires_ack,
          created_at_ms,
          available_after_ms,
          expires_at_ms,
          sent_at_ms,
          acked_at_ms,
          payload_blob,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        envelopeId,
        input.peerDeviceId,
        transport,
        'queued',
        `${input.peerDeviceId}:${envelopeId}`,
        4,
        0,
        1,
        nowMs,
        null,
        nowMs + 10 * 60 * 1000,
        null,
        null,
        encodedEnvelope,
        JSON.stringify({
          schemaVersion: DIGITAL_DELTA_SCHEMA_VERSION,
          senderDeviceId: input.actor.deviceId,
          exportedEventCount: selectedEvents.length,
        }),
      ],
    );

    await db.execute(
      `
        UPDATE sync_outbox
        SET status = ?, sent_at_ms = ?
        WHERE envelope_id = ?
      `,
      ['awaiting_ack', nowMs, envelopeId],
    );

    return {
      envelopeId,
      envelopeBytes: encodedEnvelope,
      envelopeSizeBytes: encodedEnvelope.byteLength,
      exportedEventCount: selectedEvents.length,
      estimatedBytes: deltaEnvelope.delta?.estimatedBytes ?? 0,
      toCursor: deltaEnvelope.delta?.toCursor ?? fromCursor,
    };
  }

  async processIncomingEnvelope(
    input: ProcessIncomingInput,
  ): Promise<ProcessIncomingResult> {
    const db = await this.dbProvider();
    const envelope = decodeSyncEnvelope(input.envelopeBytes);

    if (
      envelope.recipientDeviceId &&
      envelope.recipientDeviceId !== input.receiver.deviceId
    ) {
      return {
        type: envelope.type,
        envelopeId: envelope.envelopeId,
        acceptedEventIds: [],
        missingEventIds: [],
        importedEventCount: 0,
        conflictsDetected: 0,
      };
    }

    if (envelope.type === 'ACK' && envelope.ack) {
      await db.execute(
        `
          UPDATE sync_outbox
          SET status = ?, acked_at_ms = ?
          WHERE envelope_id = ?
        `,
        ['acked', Date.now(), envelope.ack.envelopeId],
      );

      await this.upsertPeerState({
        peerDeviceId: envelope.senderDeviceId,
        transport: input.transport,
        lastEnvelopeId: envelope.envelopeId,
        lastEventId: envelope.ack.mergedCursor.lastEventId,
        lastKnownClock: envelope.ack.mergedCursor.lastKnownClock,
        lastSyncedAtMs: Date.now(),
      });

      return {
        type: envelope.type,
        envelopeId: envelope.envelopeId,
        acceptedEventIds: envelope.ack.acceptedEventIds,
        missingEventIds: envelope.ack.missingEventIds,
        importedEventCount: 0,
        conflictsDetected: 0,
      };
    }

    if (envelope.type === 'NACK' && envelope.nack) {
      await db.execute(
        `
          UPDATE sync_outbox
          SET status = ?
          WHERE envelope_id = ?
        `,
        ['retry', envelope.nack.envelopeId],
      );

      return {
        type: envelope.type,
        envelopeId: envelope.envelopeId,
        acceptedEventIds: [],
        missingEventIds: [],
        importedEventCount: 0,
        conflictsDetected: 0,
      };
    }

    if (envelope.type === 'HELLO' && envelope.hello) {
      await this.upsertPeerState({
        peerDeviceId: envelope.senderDeviceId,
        transport: input.transport,
        lastEnvelopeId: envelope.envelopeId,
        lastEventId: envelope.hello.cursor.lastEventId,
        lastKnownClock: envelope.hello.cursor.lastKnownClock,
        lastSeenAtMs: Date.now(),
      });

      return {
        type: envelope.type,
        envelopeId: envelope.envelopeId,
        acceptedEventIds: [],
        missingEventIds: [],
        importedEventCount: 0,
        conflictsDetected: 0,
      };
    }

    if (envelope.type !== 'DELTA' || !envelope.delta) {
      return {
        type: envelope.type,
        envelopeId: envelope.envelopeId,
        acceptedEventIds: [],
        missingEventIds: [],
        importedEventCount: 0,
        conflictsDetected: 0,
      };
    }

    const acceptedEventIds: string[] = [];
    const missingEventIds: string[] = [];
    let conflictsDetected = 0;

    for (const wireEvent of envelope.delta.events) {
      const inserted = await this.insertLedgerEventIfMissing(wireEvent);
      if (!inserted) {
        continue;
      }

      acceptedEventIds.push(wireEvent.eventId);
      const mutationResult = await this.applyDomainMutation(wireEvent);
      conflictsDetected += mutationResult.conflictsDetected;
    }

    await this.upsertPeerState({
      peerDeviceId: envelope.senderDeviceId,
      transport: input.transport,
      lastEnvelopeId: envelope.envelopeId,
      lastEventId: envelope.delta.toCursor.lastEventId,
      lastKnownClock: envelope.delta.toCursor.lastKnownClock,
      lastSyncedAtMs: Date.now(),
    });

    const receiverClock = await this.ledgerService.getLatestVectorClockForDevice(
      input.receiver.deviceId,
    );
    const ackEnvelope = this.buildAckEnvelope({
      envelopeId: createIdentifier('ack'),
      senderDeviceId: input.receiver.deviceId,
      recipientDeviceId: envelope.senderDeviceId,
      sentAtMs: Date.now(),
      senderClock: receiverClock,
      ackedEnvelopeId: envelope.envelopeId,
      mergedCursor: {
        lastKnownClock: mergeVectorClocks(
          envelope.delta.toCursor.lastKnownClock,
          receiverClock,
        ),
        lastEventId: envelope.delta.toCursor.lastEventId,
      },
      acceptedEventIds,
      missingEventIds,
    });

    const ackEnvelopeBytes = encodeSyncEnvelope(ackEnvelope);

    return {
      type: envelope.type,
      envelopeId: envelope.envelopeId,
      acceptedEventIds,
      missingEventIds,
      importedEventCount: acceptedEventIds.length,
      conflictsDetected,
      ackEnvelopeBytes,
    };
  }

  async buildAckForOutboundEnvelope(input: {
    outboundEnvelopeId: string;
    senderDeviceId: string;
    recipientDeviceId: string;
    mergedCursor: SyncCursorWire;
  }): Promise<Uint8Array> {
    const senderClock = await this.ledgerService.getLatestVectorClockForDevice(
      input.senderDeviceId,
    );

    const ackEnvelope = this.buildAckEnvelope({
      envelopeId: createIdentifier('ack'),
      senderDeviceId: input.senderDeviceId,
      recipientDeviceId: input.recipientDeviceId,
      sentAtMs: Date.now(),
      senderClock,
      ackedEnvelopeId: input.outboundEnvelopeId,
      mergedCursor: input.mergedCursor,
      acceptedEventIds: [],
      missingEventIds: [],
    });

    return encodeSyncEnvelope(ackEnvelope);
  }

  async buildConcurrentPeerDelta(
    input: SimulatePeerDeltaInput,
  ): Promise<Uint8Array> {
    const peerCursor = await this.getPeerCursor(input.peerDeviceId);
    const occurredAtMs = input.occurredAtMs ?? Date.now();
    const nextClock = tickVectorClock(
      peerCursor.lastKnownClock,
      input.peerDeviceId,
    );
    const eventId = createIdentifier('evt');

    const wireEvent: MeshEventWire = {
      eventId,
      entityType: 'supply_item',
      entityId: input.inventoryItemId,
      eventType: 'inventory_mutation',
      actorUserId: `REMOTE-${input.peerDeviceId}`,
      actorDeviceId: input.peerDeviceId,
      actorRole: 'SUPPLY_MANAGER',
      occurredAtMs,
      vectorClock: nextClock,
      payloadType: 'digitaldelta.v1.inventory.mutation',
      payloadBlob: encodeUtf8(String(input.quantity)),
      metadataJson: JSON.stringify({
        quantity: input.quantity,
        unit: input.unit ?? 'packs',
        itemName: input.itemName ?? input.inventoryItemId,
        category: input.category ?? 'Emergency Supplies',
        storageNodeId: input.storageNodeId ?? 'REMOTE-NODE',
        status: input.status ?? 'available',
      }),
    };

    const fromCursor = peerCursor;
    const toCursor: SyncCursorWire = {
      lastKnownClock: mergeVectorClocks(fromCursor.lastKnownClock, nextClock),
      lastEventId: eventId,
    };

    const deltaEnvelope: SyncEnvelopeWire = {
      envelopeId: createIdentifier('env'),
      type: 'DELTA',
      senderDeviceId: input.peerDeviceId,
      recipientDeviceId: input.recipientDeviceId,
      sentAtMs: occurredAtMs,
      senderClock: nextClock,
      delta: {
        fromCursor,
        toCursor,
        events: [wireEvent],
        estimatedBytes: Math.max(64, wireEvent.metadataJson.length),
      },
    };

    return encodeSyncEnvelope(deltaEnvelope);
  }

  private buildDeltaEnvelope(input: {
    envelopeId: string;
    senderDeviceId: string;
    recipientDeviceId: string;
    fromCursor: SyncCursorWire;
    events: MeshEventWire[];
    sentAtMs: number;
    senderClock: VectorClockMap;
  }): SyncEnvelopeWire {
    const toCursor = buildCursorAfterEvents(input.fromCursor, input.events);

    return {
      envelopeId: input.envelopeId,
      type: 'DELTA',
      senderDeviceId: input.senderDeviceId,
      recipientDeviceId: input.recipientDeviceId,
      sentAtMs: input.sentAtMs,
      senderClock: input.senderClock,
      delta: {
        fromCursor: input.fromCursor,
        toCursor,
        events: input.events,
        estimatedBytes: estimateEventsByteLength(input.events),
      },
    };
  }

  private buildAckEnvelope(input: {
    envelopeId: string;
    senderDeviceId: string;
    recipientDeviceId: string;
    sentAtMs: number;
    senderClock: VectorClockMap;
    ackedEnvelopeId: string;
    mergedCursor: SyncCursorWire;
    acceptedEventIds: string[];
    missingEventIds: string[];
  }): SyncEnvelopeWire {
    return {
      envelopeId: input.envelopeId,
      type: 'ACK',
      senderDeviceId: input.senderDeviceId,
      recipientDeviceId: input.recipientDeviceId,
      sentAtMs: input.sentAtMs,
      senderClock: input.senderClock,
      ack: {
        envelopeId: input.ackedEnvelopeId,
        mergedCursor: input.mergedCursor,
        acceptedEventIds: input.acceptedEventIds,
        missingEventIds: input.missingEventIds,
      },
    };
  }

  private async applyDomainMutation(
    event: MeshEventWire,
  ): Promise<{ conflictsDetected: number }> {
    if (event.entityType !== 'supply_item' || event.eventType !== 'inventory_mutation') {
      return { conflictsDetected: 0 };
    }

    const db = await this.dbProvider();
    const mutation = parseInventoryMutation(event.metadataJson);
    if (typeof mutation.quantity !== 'number') {
      return { conflictsDetected: 0 };
    }

    const existingResult = await db.execute(
      `
        SELECT
          inventory_item_id AS inventoryItemId,
          item_name AS itemName,
          category,
          quantity,
          unit,
          storage_node_id AS storageNodeId,
          status,
          vector_clock_json AS vectorClockJson,
          updated_at_ms AS updatedAtMs,
          metadata_json AS metadataJson
        FROM supply_inventory
        WHERE inventory_item_id = ?
        LIMIT 1
      `,
      [event.entityId],
    );

    const row = existingResult.rows[0];

    if (!row) {
      await db.execute(
        `
          INSERT OR REPLACE INTO supply_inventory (
            inventory_item_id,
            sku,
            item_name,
            category,
            quantity,
            unit,
            storage_node_id,
            status,
            vector_clock_json,
            last_mutation_event_id,
            updated_at_ms,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          event.entityId,
          event.entityId,
          mutation.itemName ?? event.entityId,
          mutation.category ?? 'Emergency Supplies',
          mutation.quantity,
          mutation.unit ?? 'packs',
          mutation.storageNodeId ?? 'UNKNOWN',
          mutation.status ?? 'available',
          JSON.stringify(event.vectorClock),
          event.eventId,
          event.occurredAtMs,
          JSON.stringify({ source: 'remote-sync' }),
        ],
      );

      return { conflictsDetected: 0 };
    }

    const localClock = deserializeVectorClock(asOptionalString(row.vectorClockJson));
    const localState = {
      quantity: asNumber(row.quantity),
      vectorClock: localClock,
      occurredAtMs: asNumber(row.updatedAtMs),
      eventId: asString(row.inventoryItemId),
    };

    const remoteState = {
      quantity: mutation.quantity,
      vectorClock: event.vectorClock,
      occurredAtMs: event.occurredAtMs,
      eventId: event.eventId,
    };

    const merge = mergeInventoryLwwRegister({
      local: localState,
      remote: remoteState,
    });

    if (merge.concurrentConflict && localState.quantity !== remoteState.quantity) {
      await db.execute(
        `
          INSERT OR REPLACE INTO conflicts (
            conflict_id,
            conflict_type,
            entity_type,
            entity_id,
            field_name,
            local_value_blob,
            remote_value_blob,
            resolution_text,
            resolution_event_id,
            created_at_ms,
            resolved_at_ms,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          createConflictId(event.entityId, event.eventId),
          'vector_clock_divergence',
          'supply_item',
          event.entityId,
          'quantity',
          encodeUtf8(String(localState.quantity)),
          encodeUtf8(String(remoteState.quantity)),
          null,
          null,
          event.occurredAtMs,
          null,
          JSON.stringify({
            localQuantity: localState.quantity,
            remoteQuantity: remoteState.quantity,
            chosenSource: merge.chosenSource,
          }),
        ],
      );
    }

    await db.execute(
      `
        UPDATE supply_inventory
        SET
          quantity = ?,
          item_name = ?,
          category = ?,
          unit = ?,
          storage_node_id = ?,
          status = ?,
          vector_clock_json = ?,
          last_mutation_event_id = ?,
          updated_at_ms = ?,
          metadata_json = ?
        WHERE inventory_item_id = ?
      `,
      [
        merge.quantity,
        mutation.itemName ?? asString(row.itemName),
        mutation.category ?? asString(row.category),
        mutation.unit ?? asString(row.unit),
        mutation.storageNodeId ?? asString(row.storageNodeId),
        mutation.status ?? asString(row.status),
        JSON.stringify(merge.vectorClock),
        event.eventId,
        merge.occurredAtMs,
        JSON.stringify({
          ...(parseJsonRecord(row.metadataJson) ?? {}),
          lastMergeSource: merge.chosenSource,
        }),
        event.entityId,
      ],
    );

    return {
      conflictsDetected: merge.concurrentConflict ? 1 : 0,
    };
  }

  private async insertLedgerEventIfMissing(event: MeshEventWire): Promise<boolean> {
    const db = await this.dbProvider();
    const existing = await db.execute(
      'SELECT event_id AS eventId FROM ledger_events WHERE event_id = ? LIMIT 1',
      [event.eventId],
    );

    if (existing.rows.length > 0) {
      return false;
    }

    await db.execute(
      `
        INSERT OR REPLACE INTO ledger_events (
          event_id,
          entity_type,
          entity_id,
          event_type,
          actor_user_id,
          actor_device_id,
          actor_role,
          occurred_at_ms,
          vector_clock_json,
          audit_previous_hash,
          audit_payload_hash,
          audit_current_hash,
          payload_type,
          payload_blob,
          schema_version,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        event.eventId,
        event.entityType,
        event.entityId,
        event.eventType,
        event.actorUserId,
        event.actorDeviceId,
        event.actorRole,
        event.occurredAtMs,
        JSON.stringify(event.vectorClock),
        null,
        null,
        null,
        event.payloadType,
        event.payloadBlob ?? null,
        DIGITAL_DELTA_SCHEMA_VERSION,
        event.metadataJson,
      ],
    );

    return true;
  }

  private async getPeerCursor(peerDeviceId: string): Promise<SyncCursorWire> {
    const db = await this.dbProvider();
    const result = await db.execute(
      `
        SELECT
          last_vector_clock_json AS lastVectorClockJson,
          last_event_id AS lastEventId
        FROM sync_peers
        WHERE peer_device_id = ?
        LIMIT 1
      `,
      [peerDeviceId],
    );

    const row = result.rows[0];

    return {
      lastKnownClock: deserializeVectorClock(asOptionalString(row?.lastVectorClockJson)),
      lastEventId: asOptionalString(row?.lastEventId),
    };
  }

  private async upsertPeerState(input: {
    peerDeviceId: string;
    transport: SyncTransportKind;
    lastEnvelopeId?: string;
    lastEventId?: string;
    lastKnownClock: VectorClockMap;
    lastSyncedAtMs?: number;
    lastSeenAtMs?: number;
  }): Promise<void> {
    const db = await this.dbProvider();
    const nowMs = Date.now();

    await db.execute(
      `
        INSERT OR REPLACE INTO sync_peers (
          peer_device_id,
          transport,
          last_envelope_id,
          last_event_id,
          last_vector_clock_json,
          supported_capabilities_json,
          last_synced_at_ms,
          last_seen_at_ms,
          schema_version,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.peerDeviceId,
        input.transport,
        input.lastEnvelopeId ?? null,
        input.lastEventId ?? null,
        JSON.stringify(input.lastKnownClock),
        JSON.stringify([...SYNC_CAPABILITIES]),
        input.lastSyncedAtMs ?? null,
        input.lastSeenAtMs ?? nowMs,
        DIGITAL_DELTA_SCHEMA_VERSION,
        JSON.stringify({}),
      ],
    );
  }
}

function mapLedgerEventToWire(event: LedgerAppendInput): MeshEventWire {
  return {
    eventId: event.eventId,
    entityType: event.entityType,
    entityId: event.entityId,
    eventType: event.eventType,
    actorUserId: event.actor.userId,
    actorDeviceId: event.actor.deviceId,
    actorRole: event.actor.role,
    occurredAtMs: event.occurredAtMs,
    vectorClock: event.vectorClock,
    payloadType: event.payloadType,
    payloadBlob: event.payloadBlob,
    metadataJson: JSON.stringify(event.metadata ?? {}),
  };
}

function buildCursorAfterEvents(
  fromCursor: SyncCursorWire,
  events: MeshEventWire[],
): SyncCursorWire {
  let cursorClock = { ...fromCursor.lastKnownClock };
  let lastEventId = fromCursor.lastEventId;

  for (const event of events) {
    cursorClock = mergeVectorClocks(cursorClock, event.vectorClock);
    lastEventId = event.eventId;
  }

  return {
    lastKnownClock: cursorClock,
    lastEventId,
  };
}

function estimateEventsByteLength(events: MeshEventWire[]): number {
  return events.reduce((totalBytes, event) => {
    const metadataBytes = event.metadataJson.length;
    const payloadBytes = event.payloadBlob?.byteLength ?? 0;
    return totalBytes + metadataBytes + payloadBytes + 96;
  }, 0);
}

function parseInventoryMutation(metadataJson: string): {
  quantity?: number;
  itemName?: string;
  category?: string;
  unit?: string;
  storageNodeId?: string;
  status?: string;
} {
  const metadata = parseJsonRecord(metadataJson);

  return {
    quantity: typeof metadata.quantity === 'number' ? metadata.quantity : undefined,
    itemName: asOptionalString(metadata.itemName),
    category: asOptionalString(metadata.category),
    unit: asOptionalString(metadata.unit),
    storageNodeId: asOptionalString(metadata.storageNodeId),
    status: asOptionalString(metadata.status),
  };
}

function createConflictId(entityId: string, eventId: string): string {
  return `cnf-${entityId}-${eventId}`.slice(0, 120);
}

function createIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
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

function asString(value: Scalar | unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: Scalar | unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: Scalar | unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
