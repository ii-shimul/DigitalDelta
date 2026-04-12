import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type {
  ConflictRecordInput,
  ConflictResolutionChoice,
  LedgerAppendInput,
  LedgerDeltaRequest,
  LedgerService,
} from '../contracts';
import {
  compareVectorClocks,
  deserializeVectorClock,
  type VectorClockMap,
} from '../crdt';
import type { DatabaseHandle } from '../../db';

declare const require: undefined | ((moduleName: string) => unknown);

type Scalar = SQLiteScalar | undefined;

export interface AuthLedgerService extends LedgerService {
  getLatestVectorClockForDevice(deviceId: string): Promise<VectorClockMap>;
}

export function createSQLiteLedgerService(
  dbProvider: (() => Promise<DatabaseHandle>) | undefined = undefined,
): AuthLedgerService {
  const resolvedDbProvider = dbProvider ?? getDefaultDatabaseProvider();

  return {
    async appendEvent(input) {
      await this.appendEvents([input]);
    },
    async appendEvents(inputs) {
      const db = await resolvedDbProvider();

      for (const input of inputs) {
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
            input.eventId,
            input.entityType,
            input.entityId,
            input.eventType,
            input.actor.userId,
            input.actor.deviceId,
            input.actor.role,
            input.occurredAtMs,
            JSON.stringify(input.vectorClock),
            null,
            null,
            null,
            input.payloadType,
            input.payloadBlob ?? null,
            'digitaldelta.v1',
            JSON.stringify(input.metadata ?? {}),
          ],
        );
      }
    },
    async getDeltaSince(request) {
      const db = await resolvedDbProvider();
      const result = await db.execute(
        `
          SELECT
            event_id AS eventId,
            entity_type AS entityType,
            entity_id AS entityId,
            event_type AS eventType,
            actor_user_id AS actorUserId,
            actor_device_id AS actorDeviceId,
            actor_role AS actorRole,
            occurred_at_ms AS occurredAtMs,
            vector_clock_json AS vectorClockJson,
            payload_type AS payloadType,
            payload_blob AS payloadBlob,
            metadata_json AS metadataJson
          FROM ledger_events
          ORDER BY occurred_at_ms ASC, event_id ASC
        `,
      );

      const events = result.rows.map(mapLedgerEventRow);
      return events.filter(event => {
        if (request.lastEventId && event.eventId === request.lastEventId) {
          return false;
        }

        return (
          compareVectorClocks(event.vectorClock, request.lastKnownClock) ===
            'after' ||
          compareVectorClocks(event.vectorClock, request.lastKnownClock) ===
            'concurrent'
        );
      });
    },
    async recordConflict(input) {
      const db = await resolvedDbProvider();
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
            created_at_ms,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.conflictId,
          'concurrent_write',
          input.entityType,
          input.entityId,
          input.fieldName,
          input.localValue,
          input.remoteValue,
          input.createdAtMs,
          JSON.stringify({}),
        ],
      );
    },
    async resolveConflict(input) {
      const db = await resolvedDbProvider();
      await db.execute(
        `
          UPDATE conflicts
          SET resolution_text = ?, resolved_at_ms = ?
          WHERE conflict_id = ?
        `,
        [input.resolution, input.resolvedAtMs, input.conflictId],
      );
    },
    async getLatestVectorClockForDevice(deviceId) {
      const db = await resolvedDbProvider();
      const result = await db.execute(
        `
          SELECT vector_clock_json AS vectorClockJson
          FROM ledger_events
          WHERE actor_device_id = ?
          ORDER BY occurred_at_ms DESC, event_id DESC
          LIMIT 1
        `,
        [deviceId],
      );

      const row = result.rows[0];
      return deserializeVectorClock(asOptionalString(row?.vectorClockJson));
    },
  };
}

function getDefaultDatabaseProvider(): () => Promise<DatabaseHandle> {
  if (typeof require !== 'function') {
    throw new Error('SQLite ledger service requires a runtime module loader.');
  }

  const dbModule = require('../../db') as {
    getDatabase: () => Promise<DatabaseHandle>;
  };

  return dbModule.getDatabase;
}

export function createInMemoryLedgerService(seed?: {
  events?: LedgerAppendInput[];
  conflicts?: Array<
    {
      conflictId: string;
      resolution?: ConflictResolutionChoice;
      resolvedAtMs?: number;
    } & ConflictRecordInput
  >;
}): AuthLedgerService {
  const events = [...(seed?.events ?? [])];
  const conflicts = new Map(
    (seed?.conflicts ?? []).map(conflict => [
      conflict.conflictId,
      { ...conflict },
    ]),
  );

  return {
    async appendEvent(input) {
      events.push(cloneLedgerEvent(input));
    },
    async appendEvents(inputs) {
      for (const input of inputs) {
        events.push(cloneLedgerEvent(input));
      }
    },
    async getDeltaSince(request) {
      return events.filter(event => {
        if (request.lastEventId && event.eventId === request.lastEventId) {
          return false;
        }

        const relation = compareVectorClocks(
          event.vectorClock,
          request.lastKnownClock,
        );
        return relation === 'after' || relation === 'concurrent';
      });
    },
    async recordConflict(input) {
      conflicts.set(input.conflictId, { ...input });
    },
    async resolveConflict(input) {
      const existing = conflicts.get(input.conflictId);
      if (!existing) {
        return;
      }

      conflicts.set(input.conflictId, {
        ...existing,
        resolution: input.resolution,
        resolvedAtMs: input.resolvedAtMs,
      });
    },
    async getLatestVectorClockForDevice(deviceId) {
      const latestEvent = [...events]
        .filter(event => event.actor.deviceId === deviceId)
        .sort((left, right) => right.occurredAtMs - left.occurredAtMs)[0];

      return latestEvent ? { ...latestEvent.vectorClock } : {};
    },
  };
}

function mapLedgerEventRow(row: Record<string, Scalar>): LedgerAppendInput {
  return {
    eventId: asString(row.eventId),
    entityType: asString(row.entityType) as LedgerAppendInput['entityType'],
    entityId: asString(row.entityId),
    eventType: asString(row.eventType) as LedgerAppendInput['eventType'],
    actor: {
      userId: asString(row.actorUserId),
      deviceId: asString(row.actorDeviceId),
      role: asString(row.actorRole) as LedgerAppendInput['actor']['role'],
    },
    occurredAtMs: asNumber(row.occurredAtMs),
    vectorClock: deserializeVectorClock(asOptionalString(row.vectorClockJson)),
    payloadType: asString(row.payloadType),
    payloadBlob: asBlob(row.payloadBlob),
    metadata: parseJsonRecord(row.metadataJson),
  };
}

function cloneLedgerEvent(input: LedgerAppendInput): LedgerAppendInput {
  return {
    ...input,
    actor: { ...input.actor },
    vectorClock: { ...input.vectorClock },
    payloadBlob: input.payloadBlob
      ? new Uint8Array(input.payloadBlob)
      : undefined,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

function asString(value: Scalar): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: Scalar): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: Scalar): number {
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

function asBlob(value: Scalar): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return undefined;
}

function parseJsonRecord(value: Scalar): Record<string, unknown> {
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
