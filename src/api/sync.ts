import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import {
  createSQLiteAuthService,
  createSQLiteLedgerService,
  DIGITAL_DELTA_SCHEMA_VERSION,
  encodeUtf8,
  tickVectorClock,
  type AppRole,
} from '../core';
import { getDatabase } from '../db';
import {
  BleMeshTransport,
  InMemoryLoopbackTransport,
  type MeshTransport,
  createSQLiteMeshSyncService,
  type MeshSyncActor,
  type SyncTransportKind,
} from '../core/mesh';

import type { AuthenticatedSession } from './auth';
import { normalizeAuthRole } from './auth';
import type { LoginScreenData } from './screen-contracts';

type Scalar = SQLiteScalar | undefined;

export type DeltaSyncCycleResult = {
  peerDeviceId: string;
  transport: SyncTransportKind;
  transportSent: boolean;
  exportedEventCount: number;
  importedEventCount: number;
  conflictsDetected: number;
  envelopeSizeBytes: number;
  estimatedBytes: number;
  localMutationEventId?: string;
  localMutationItemId?: string;
  localMutationQuantity?: number;
};

export class SyncApi {
  private readonly syncService = createSQLiteMeshSyncService();

  private readonly authService = createSQLiteAuthService();

  private readonly ledgerService = createSQLiteLedgerService();

  async runDeltaSyncCycle(input: {
    loginData: LoginScreenData;
    session?: AuthenticatedSession;
    peerDeviceId?: string;
    transport?: SyncTransportKind;
    listenWindowMs?: number;
  }): Promise<DeltaSyncCycleResult> {
    const actor = buildActor(input.loginData, input.session);
    await this.assertWritePermission(actor, 'supply_item');

    const peerDeviceId =
      input.peerDeviceId ??
      (await this.findBestPeerDeviceId(actor.deviceId)) ??
      'DEV-BRAVO-02';
    const transport = input.transport ?? 'loopback';
    const listenWindowMs = Math.max(500, input.listenWindowMs ?? 5000);

    const localMutation = await this.applyLocalInventoryMutation(actor);

    const queued = await this.syncService.queueDeltaForPeer({
      peerDeviceId,
      actor,
      transport,
    });

    let importedEventCount = 0;
    let conflictsDetected = 0;

    const transportAdapter = this.createTransportAdapter(transport, actor.deviceId);
    let processingQueue = Promise.resolve();
    const detachPacketHandler = transportAdapter.onPacket(packet => {
      processingQueue = processingQueue
        .then(async () => {
          const inboundResult = await this.syncService.processIncomingEnvelope({
            envelopeBytes: packet.payload,
            receiver: actor,
            transport,
          });

          importedEventCount += inboundResult.importedEventCount;
          conflictsDetected += inboundResult.conflictsDetected;

          if (inboundResult.ackEnvelopeBytes) {
            await transportAdapter.send(
              packet.peerDeviceId,
              inboundResult.ackEnvelopeBytes,
            );
          }
        })
        .catch(() => undefined);
    });

    let transportSent = false;

    try {
      await transportAdapter.start();
      await transportAdapter.send(peerDeviceId, queued.envelopeBytes);
      transportSent = true;
      await wait(listenWindowMs);
      await processingQueue;
    } finally {
      detachPacketHandler();
      await transportAdapter.stop();
    }

    return {
      peerDeviceId,
      transport,
      transportSent,
      exportedEventCount: queued.exportedEventCount,
      importedEventCount,
      conflictsDetected,
      envelopeSizeBytes: queued.envelopeSizeBytes,
      estimatedBytes: queued.estimatedBytes,
      localMutationEventId: localMutation.eventId,
      localMutationItemId: localMutation.inventoryItemId,
      localMutationQuantity: localMutation.quantity,
    };
  }

  private createTransportAdapter(
    transport: SyncTransportKind,
    localDeviceId: string,
  ): MeshTransport {
    if (transport === 'bluetooth_le') {
      return new BleMeshTransport();
    }

    return new InMemoryLoopbackTransport(localDeviceId);
  }

  private async findBestPeerDeviceId(
    localDeviceId: string,
  ): Promise<string | undefined> {
    const db = await getDatabase();
    const result = await db.execute(
      `
        SELECT
          peer_device_id AS peerDeviceId
        FROM sync_peers
        WHERE peer_device_id != ?
        ORDER BY COALESCE(last_seen_at_ms, 0) DESC, peer_device_id ASC
        LIMIT 1
      `,
      [localDeviceId],
    );

    return asOptionalString(result.rows[0]?.peerDeviceId);
  }

  private async applyLocalInventoryMutation(actor: MeshSyncActor): Promise<{
    eventId: string;
    inventoryItemId: string;
    quantity: number;
    itemName: string;
    category: string;
    unit: string;
    storageNodeId: string;
    status: string;
  }> {
    const db = await getDatabase();
    const inventoryResult = await db.execute(
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
          metadata_json AS metadataJson
        FROM supply_inventory
        ORDER BY updated_at_ms DESC, inventory_item_id ASC
        LIMIT 1
      `,
    );

    const inventoryRow = inventoryResult.rows[0];
    if (!inventoryRow) {
      throw new Error('No inventory item found to create a local mutation.');
    }

    const currentQuantity = asNumber(inventoryRow.quantity);
    const nextQuantity = currentQuantity + 1;
    const previousClock = await this.ledgerService.getLatestVectorClockForDevice(
      actor.deviceId,
    );
    const nextClock = tickVectorClock(previousClock, actor.deviceId);
    const eventId = createIdentifier('evt');
    const occurredAtMs = Date.now();

    await db.execute(
      `
        UPDATE supply_inventory
        SET
          quantity = ?,
          vector_clock_json = ?,
          last_mutation_event_id = ?,
          updated_at_ms = ?,
          metadata_json = ?
        WHERE inventory_item_id = ?
      `,
      [
        nextQuantity,
        JSON.stringify(nextClock),
        eventId,
        occurredAtMs,
        JSON.stringify({
          ...parseJsonRecord(inventoryRow.metadataJson),
          lastLocalMutationBy: actor.deviceId,
        }),
        asString(inventoryRow.inventoryItemId),
      ],
    );

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
        eventId,
        'supply_item',
        asString(inventoryRow.inventoryItemId),
        'inventory_mutation',
        actor.userId,
        actor.deviceId,
        actor.role,
        occurredAtMs,
        JSON.stringify(nextClock),
        null,
        null,
        null,
        'digitaldelta.v1.inventory.mutation',
        encodeUtf8(String(nextQuantity)),
        DIGITAL_DELTA_SCHEMA_VERSION,
        JSON.stringify({
          quantity: nextQuantity,
          unit: asString(inventoryRow.unit),
          itemName: asString(inventoryRow.itemName),
          category: asString(inventoryRow.category),
          storageNodeId: asString(inventoryRow.storageNodeId),
          status: asString(inventoryRow.status),
        }),
      ],
    );

    return {
      eventId,
      inventoryItemId: asString(inventoryRow.inventoryItemId),
      quantity: nextQuantity,
      itemName: asString(inventoryRow.itemName),
      category: asString(inventoryRow.category),
      unit: asString(inventoryRow.unit),
      storageNodeId: asString(inventoryRow.storageNodeId),
      status: asString(inventoryRow.status),
    };
  }

  private async assertWritePermission(
    actor: MeshSyncActor,
    resource: 'supply_item',
  ): Promise<void> {
    const allowed = await this.authService.hasPermission({
      actor,
      resource,
      action: 'write',
    });

    if (!allowed) {
      throw new Error('Current role is not allowed to mutate sync inventory records.');
    }
  }
}

function buildActor(
  loginData: LoginScreenData,
  session?: AuthenticatedSession,
): MeshSyncActor {
  if (session) {
    return {
      userId: session.userId,
      deviceId: session.deviceId,
      role: session.activeRole,
      displayName: session.displayName,
    };
  }

  const role = normalizeAuthRole(loginData.primaryRole) ?? 'FIELD_VOLUNTEER';

  return {
    userId: loginData.userId,
    deviceId: loginData.deviceId,
    role,
    displayName: loginData.displayName,
  };
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

function wait(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs);
  });
}
