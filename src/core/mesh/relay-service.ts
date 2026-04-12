import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type { DatabaseHandle } from '../../db';
import { getDatabase } from '../../db';
import {
  createSQLiteLedgerService,
  type AuthLedgerService,
} from '../auth/ledger-service';
import { createSecureDeviceKeyVault, type DeviceKeyVault } from '../auth/key-vault';
import { encodeUtf8 } from '../auth/crypto';
import type { AppRole } from '../contracts';
import { tickVectorClock } from '../crdt';

import {
  base64ToBytes,
  bytesToBase64,
  decryptFromSender,
  deriveMeshKeyPairFromIdentity,
  deriveMeshPublicKeyFromEd25519PublicPem,
  encryptForRecipient,
} from './crypto';
import {
  decodeMeshForwardPacket,
  encodeMeshForwardPacket,
  type MeshForwardPacketWire,
} from './protocol';

type Scalar = SQLiteScalar | undefined;

export type MeshNodeRole = 'client' | 'relay';

export type MeshActor = {
  userId: string;
  deviceId: string;
  role: AppRole;
};

export type MeshRoleEvaluationInput = {
  actor: MeshActor;
  batteryPercent: number;
  signalStrength: number;
  nearbyPeerCount: number;
  proximityScore?: number;
};

export type MeshRoleEvaluationResult = {
  role: MeshNodeRole;
  changed: boolean;
  relayScore: number;
  previousRole?: MeshNodeRole;
};

export type QueueEncryptedMessageInput = {
  actor: MeshActor;
  recipientDeviceId: string;
  plaintext: Uint8Array;
  nextHopDeviceId?: string;
  ttlHops?: number;
};

export type QueueEncryptedMessageResult = {
  packetId: string;
  queueId: string;
  nextHopDeviceId?: string;
  ttlHops: number;
  hopCount: number;
};

export type DispatchQueueInput = {
  ownerDeviceId: string;
  online: boolean;
  maxPackets?: number;
};

export type MeshPacketDispatch = {
  queueId: string;
  packetId: string;
  toPeerDeviceId: string;
  packetBytes: Uint8Array;
};

export type DispatchQueueResult = {
  ownerDeviceId: string;
  sentCount: number;
  heldCount: number;
  dispatches: MeshPacketDispatch[];
};

export type ReceiveForwardPacketInput = {
  receiverDeviceId: string;
  fromPeerDeviceId: string;
  packetBytes: Uint8Array;
};

export type ReceiveForwardPacketResult = {
  packetId: string;
  duplicate: boolean;
  deliveredToRecipient: boolean;
  queuedForRelay: boolean;
  dropped: boolean;
  plaintext?: Uint8Array;
};

export function createSQLiteMeshRelayService(
  dbProvider?: () => Promise<DatabaseHandle>,
  options: {
    keyVault?: DeviceKeyVault;
  } = {},
): SQLiteMeshRelayService {
  const resolvedDbProvider = dbProvider ?? getDatabase;
  return new SQLiteMeshRelayService(resolvedDbProvider, {
    keyVault: options.keyVault ?? createSecureDeviceKeyVault(),
    ledgerService: createSQLiteLedgerService(resolvedDbProvider),
  });
}

export class SQLiteMeshRelayService {
  constructor(
    private readonly dbProvider: () => Promise<DatabaseHandle>,
    private readonly services: {
      keyVault: DeviceKeyVault;
      ledgerService: AuthLedgerService;
    },
  ) {}

  async evaluateNodeRole(
    input: MeshRoleEvaluationInput,
  ): Promise<MeshRoleEvaluationResult> {
    const db = await this.dbProvider();
    const nowMs = Date.now();
    const proximityScore = input.proximityScore ?? 0;
    const relayScore = computeRelayScore({
      batteryPercent: input.batteryPercent,
      signalStrength: input.signalStrength,
      nearbyPeerCount: input.nearbyPeerCount,
      proximityScore,
    });

    const nextRole = relayScore >= 55 ? 'relay' : 'client';
    const existing = await db.execute(
      `
        SELECT
          current_role AS currentRole
        FROM mesh_node_state
        WHERE device_id = ?
        LIMIT 1
      `,
      [input.actor.deviceId],
    );

    const previousRole = asOptionalString(existing.rows[0]?.currentRole) as
      | MeshNodeRole
      | undefined;
    const changed = previousRole !== nextRole;

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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.actor.deviceId,
        nextRole,
        relayScore,
        input.batteryPercent,
        input.signalStrength,
        input.nearbyPeerCount,
        changed ? nowMs : null,
        nowMs,
        JSON.stringify({ proximityScore }),
      ],
    );

    if (changed) {
      await this.appendRoleChangeLedgerEvent({
        actor: input.actor,
        previousRole,
        nextRole,
        relayScore,
        occurredAtMs: nowMs,
      });

      await this.appendRelayLog({
        packetId: '-',
        ownerDeviceId: input.actor.deviceId,
        action: 'role_switch',
        status: 'changed',
        detail: `${previousRole ?? 'unknown'} -> ${nextRole}`,
        occurredAtMs: nowMs,
      });
    }

    return {
      role: nextRole,
      changed,
      relayScore,
      previousRole,
    };
  }

  async queueEncryptedMessage(
    input: QueueEncryptedMessageInput,
  ): Promise<QueueEncryptedMessageResult> {
    const db = await this.dbProvider();
    const nowMs = Date.now();
    const ttlHops = Math.max(1, input.ttlHops ?? 4);

    const senderMeshKey = await this.getMeshKeyPairForLocalDevice(
      input.actor.deviceId,
    );
    const recipientPublicKey = await this.getOrCreateRecipientPublicMeshKey(
      input.recipientDeviceId,
    );

    const encryptedPayload = encryptForRecipient({
      plaintext: input.plaintext,
      senderSecretKey: senderMeshKey.secretKey,
      recipientPublicKey,
    });

    const packetId = createIdentifier('pkt');
    const packet: MeshForwardPacketWire = {
      packetId,
      senderDeviceId: input.actor.deviceId,
      recipientDeviceId: input.recipientDeviceId,
      nextHopDeviceId: input.nextHopDeviceId,
      ttlHops,
      hopCount: 0,
      createdAtMs: nowMs,
      senderMeshPublicKey: senderMeshKey.publicKey,
      nonce: encryptedPayload.nonce,
      ciphertext: encryptedPayload.ciphertext,
      payloadHashHex: encryptedPayload.payloadHashHex,
    };

    const packetBytes = encodeMeshForwardPacket(packet);
    const queueId = createIdentifier('q');

    await db.execute(
      `
        INSERT INTO mesh_store_queue (
          queue_id,
          owner_device_id,
          packet_id,
          sender_device_id,
          recipient_device_id,
          next_hop_device_id,
          ttl_hops,
          hop_count,
          status,
          packet_blob,
          payload_hash,
          created_at_ms,
          updated_at_ms,
          last_attempt_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        queueId,
        input.actor.deviceId,
        packetId,
        packet.senderDeviceId,
        packet.recipientDeviceId,
        packet.nextHopDeviceId ?? null,
        packet.ttlHops,
        packet.hopCount,
        'stored',
        packetBytes,
        packet.payloadHashHex,
        nowMs,
        nowMs,
        null,
        JSON.stringify({}),
      ],
    );

    await this.markSeenEnvelope({
      ownerDeviceId: input.actor.deviceId,
      packet,
      status: 'originated',
      observedAtMs: nowMs,
    });

    await this.appendRelayLog({
      packetId,
      ownerDeviceId: input.actor.deviceId,
      action: 'enqueue',
      status: 'stored',
      detail: `recipient=${input.recipientDeviceId} · ciphertext=${packet.ciphertext.length}B`,
      occurredAtMs: nowMs,
      metadata: {
        nextHopDeviceId: input.nextHopDeviceId,
        ttlHops,
        payloadHashHex: packet.payloadHashHex,
      },
    });

    return {
      packetId,
      queueId,
      nextHopDeviceId: input.nextHopDeviceId,
      ttlHops,
      hopCount: 0,
    };
  }

  async dispatchQueuedPackets(
    input: DispatchQueueInput,
  ): Promise<DispatchQueueResult> {
    const db = await this.dbProvider();

    const queuedResult = await db.execute(
      `
        SELECT
          queue_id AS queueId,
          packet_id AS packetId,
          recipient_device_id AS recipientDeviceId,
          next_hop_device_id AS nextHopDeviceId,
          ttl_hops AS ttlHops,
          hop_count AS hopCount,
          packet_blob AS packetBlob,
          status
        FROM mesh_store_queue
        WHERE owner_device_id = ?
          AND status IN ('stored', 'retry')
        ORDER BY updated_at_ms ASC
      `,
      [input.ownerDeviceId],
    );

    if (!input.online) {
      return {
        ownerDeviceId: input.ownerDeviceId,
        sentCount: 0,
        heldCount: queuedResult.rows.length,
        dispatches: [],
      };
    }

    const limit = Math.max(1, input.maxPackets ?? 32);
    const dispatches: MeshPacketDispatch[] = [];

    for (const row of queuedResult.rows.slice(0, limit)) {
      const packet = decodeMeshForwardPacket(asBlob(row.packetBlob) ?? new Uint8Array());
      if (packet.hopCount >= packet.ttlHops) {
        await db.execute(
          `
            UPDATE mesh_store_queue
            SET status = ?, updated_at_ms = ?
            WHERE queue_id = ?
          `,
          ['dropped', Date.now(), asString(row.queueId)],
        );

        await this.appendRelayLog({
          packetId: packet.packetId,
          ownerDeviceId: input.ownerDeviceId,
          action: 'dispatch',
          status: 'dropped_ttl',
          detail: 'TTL exhausted before dispatch.',
          occurredAtMs: Date.now(),
        });
        continue;
      }

      const nextHopDeviceId =
        asOptionalString(row.nextHopDeviceId) ??
        (await this.inferNextHop(input.ownerDeviceId, asString(row.recipientDeviceId)));

      if (!nextHopDeviceId) {
        await db.execute(
          `
            UPDATE mesh_store_queue
            SET status = ?, updated_at_ms = ?
            WHERE queue_id = ?
          `,
          ['retry', Date.now(), asString(row.queueId)],
        );

        await this.appendRelayLog({
          packetId: packet.packetId,
          ownerDeviceId: input.ownerDeviceId,
          action: 'dispatch',
          status: 'blocked',
          detail: 'No eligible next hop available.',
          occurredAtMs: Date.now(),
        });
        continue;
      }

      const forwardedPacket: MeshForwardPacketWire = {
        ...packet,
        hopCount: packet.hopCount + 1,
        nextHopDeviceId,
      };
      const packetBytes = encodeMeshForwardPacket(forwardedPacket);

      await db.execute(
        `
          UPDATE mesh_store_queue
          SET status = ?,
              next_hop_device_id = ?,
              hop_count = ?,
              packet_blob = ?,
              last_attempt_at_ms = ?,
              updated_at_ms = ?
          WHERE queue_id = ?
        `,
        [
          'forwarded',
          nextHopDeviceId,
          forwardedPacket.hopCount,
          packetBytes,
          Date.now(),
          Date.now(),
          asString(row.queueId),
        ],
      );

      await this.appendRelayLog({
        packetId: packet.packetId,
        ownerDeviceId: input.ownerDeviceId,
        action: 'dispatch',
        toPeerDeviceId: nextHopDeviceId,
        status: 'forwarded',
        detail: `hop=${forwardedPacket.hopCount}/${forwardedPacket.ttlHops}`,
        occurredAtMs: Date.now(),
      });

      dispatches.push({
        queueId: asString(row.queueId),
        packetId: packet.packetId,
        toPeerDeviceId: nextHopDeviceId,
        packetBytes,
      });
    }

    return {
      ownerDeviceId: input.ownerDeviceId,
      sentCount: dispatches.length,
      heldCount: Math.max(0, queuedResult.rows.length - dispatches.length),
      dispatches,
    };
  }

  async receiveForwardedPacket(
    input: ReceiveForwardPacketInput,
  ): Promise<ReceiveForwardPacketResult> {
    const db = await this.dbProvider();
    const nowMs = Date.now();
    const packet = decodeMeshForwardPacket(input.packetBytes);

    const seenResult = await db.execute(
      `
        SELECT packet_id AS packetId
        FROM mesh_seen_envelopes
        WHERE owner_device_id = ? AND packet_id = ?
        LIMIT 1
      `,
      [input.receiverDeviceId, packet.packetId],
    );

    if (seenResult.rows.length > 0) {
      await db.execute(
        `
          UPDATE mesh_seen_envelopes
          SET last_seen_at_ms = ?, status = ?
          WHERE owner_device_id = ? AND packet_id = ?
        `,
        [nowMs, 'duplicate', input.receiverDeviceId, packet.packetId],
      );

      await this.appendRelayLog({
        packetId: packet.packetId,
        ownerDeviceId: input.receiverDeviceId,
        action: 'receive',
        fromPeerDeviceId: input.fromPeerDeviceId,
        status: 'duplicate',
        detail: 'Packet dropped by dedup cache.',
        occurredAtMs: nowMs,
      });

      return {
        packetId: packet.packetId,
        duplicate: true,
        deliveredToRecipient: false,
        queuedForRelay: false,
        dropped: true,
      };
    }

    if (packet.hopCount > packet.ttlHops) {
      await this.markSeenEnvelope({
        ownerDeviceId: input.receiverDeviceId,
        packet,
        status: 'dropped_ttl',
        observedAtMs: nowMs,
      });

      await this.appendRelayLog({
        packetId: packet.packetId,
        ownerDeviceId: input.receiverDeviceId,
        action: 'receive',
        fromPeerDeviceId: input.fromPeerDeviceId,
        status: 'dropped_ttl',
        detail: 'TTL exhausted at receive boundary.',
        occurredAtMs: nowMs,
      });

      return {
        packetId: packet.packetId,
        duplicate: false,
        deliveredToRecipient: false,
        queuedForRelay: false,
        dropped: true,
      };
    }

    await this.markSeenEnvelope({
      ownerDeviceId: input.receiverDeviceId,
      packet,
      status: 'received',
      observedAtMs: nowMs,
    });

    if (packet.recipientDeviceId === input.receiverDeviceId) {
      const receiverMeshKey = await this.getMeshKeyPairForLocalDevice(
        input.receiverDeviceId,
      );
      const plaintext = decryptFromSender({
        ciphertext: packet.ciphertext,
        nonce: packet.nonce,
        senderPublicKey: packet.senderMeshPublicKey,
        recipientSecretKey: receiverMeshKey.secretKey,
      });

      const delivered = Boolean(plaintext);
      await this.appendRelayLog({
        packetId: packet.packetId,
        ownerDeviceId: input.receiverDeviceId,
        action: 'receive',
        fromPeerDeviceId: input.fromPeerDeviceId,
        status: delivered ? 'delivered' : 'decrypt_failed',
        detail: delivered
          ? 'Recipient decrypted payload successfully.'
          : 'Recipient decryption failed.',
        occurredAtMs: nowMs,
      });

      return {
        packetId: packet.packetId,
        duplicate: false,
        deliveredToRecipient: delivered,
        queuedForRelay: false,
        dropped: !delivered,
        plaintext: plaintext ?? undefined,
      };
    }

    const queueId = createIdentifier('q');
    await db.execute(
      `
        INSERT OR REPLACE INTO mesh_store_queue (
          queue_id,
          owner_device_id,
          packet_id,
          sender_device_id,
          recipient_device_id,
          next_hop_device_id,
          ttl_hops,
          hop_count,
          status,
          packet_blob,
          payload_hash,
          created_at_ms,
          updated_at_ms,
          last_attempt_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        queueId,
        input.receiverDeviceId,
        packet.packetId,
        packet.senderDeviceId,
        packet.recipientDeviceId,
        packet.nextHopDeviceId ?? null,
        packet.ttlHops,
        packet.hopCount,
        'stored',
        input.packetBytes,
        packet.payloadHashHex,
        nowMs,
        nowMs,
        null,
        JSON.stringify({ relayedFrom: input.fromPeerDeviceId }),
      ],
    );

    await this.appendRelayLog({
      packetId: packet.packetId,
      ownerDeviceId: input.receiverDeviceId,
      action: 'receive',
      fromPeerDeviceId: input.fromPeerDeviceId,
      status: 'stored_for_forward',
      detail: `recipient=${packet.recipientDeviceId} · encrypted=${packet.ciphertext.length}B`,
      occurredAtMs: nowMs,
    });

    return {
      packetId: packet.packetId,
      duplicate: false,
      deliveredToRecipient: false,
      queuedForRelay: true,
      dropped: false,
    };
  }

  async listRecentRelayLogs(ownerDeviceId: string, limit = 50): Promise<
    Array<{
      action: string;
      status: string;
      detail?: string;
      occurredAtMs: number;
      packetId: string;
    }>
  > {
    const db = await this.dbProvider();
    const result = await db.execute(
      `
        SELECT
          action,
          status,
          detail,
          occurred_at_ms AS occurredAtMs,
          packet_id AS packetId
        FROM mesh_relay_log
        WHERE owner_device_id = ?
        ORDER BY occurred_at_ms DESC
        LIMIT ?
      `,
      [ownerDeviceId, Math.max(1, limit)],
    );

    return result.rows.map(row => ({
      action: asString(row.action),
      status: asString(row.status),
      detail: asOptionalString(row.detail),
      occurredAtMs: asNumber(row.occurredAtMs),
      packetId: asString(row.packetId),
    }));
  }

  private async appendRoleChangeLedgerEvent(input: {
    actor: MeshActor;
    previousRole?: MeshNodeRole;
    nextRole: MeshNodeRole;
    relayScore: number;
    occurredAtMs: number;
  }): Promise<void> {
    const previousClock =
      await this.services.ledgerService.getLatestVectorClockForDevice(
        input.actor.deviceId,
      );

    await this.services.ledgerService.appendEvent({
      eventId: createIdentifier('evt-mesh-role'),
      entityType: 'device',
      entityId: input.actor.deviceId,
      eventType: 'mesh_role_changed',
      actor: {
        userId: input.actor.userId,
        deviceId: input.actor.deviceId,
        role: input.actor.role,
      },
      occurredAtMs: input.occurredAtMs,
      vectorClock: tickVectorClock(previousClock, input.actor.deviceId),
      payloadType: 'digitaldelta.v1.mesh.role-change',
      payloadBlob: encodeUtf8(
        JSON.stringify({
          previousRole: input.previousRole,
          nextRole: input.nextRole,
          relayScore: input.relayScore,
        }),
      ),
      metadata: {
        previousRole: input.previousRole,
        nextRole: input.nextRole,
        relayScore: input.relayScore,
      },
    });
  }

  private async markSeenEnvelope(input: {
    ownerDeviceId: string;
    packet: MeshForwardPacketWire;
    status: string;
    observedAtMs: number;
  }): Promise<void> {
    const db = await this.dbProvider();
    await db.execute(
      `
        INSERT OR REPLACE INTO mesh_seen_envelopes (
          owner_device_id,
          packet_id,
          sender_device_id,
          recipient_device_id,
          payload_hash,
          hop_count,
          ttl_hops,
          first_seen_at_ms,
          last_seen_at_ms,
          status,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.ownerDeviceId,
        input.packet.packetId,
        input.packet.senderDeviceId,
        input.packet.recipientDeviceId,
        input.packet.payloadHashHex,
        input.packet.hopCount,
        input.packet.ttlHops,
        input.observedAtMs,
        input.observedAtMs,
        input.status,
        JSON.stringify({}),
      ],
    );
  }

  private async appendRelayLog(input: {
    packetId: string;
    ownerDeviceId: string;
    action: string;
    status: string;
    detail?: string;
    occurredAtMs: number;
    fromPeerDeviceId?: string;
    toPeerDeviceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const db = await this.dbProvider();
    await db.execute(
      `
        INSERT OR REPLACE INTO mesh_relay_log (
          log_id,
          packet_id,
          owner_device_id,
          action,
          from_peer_device_id,
          to_peer_device_id,
          status,
          detail,
          occurred_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        createIdentifier('log'),
        input.packetId,
        input.ownerDeviceId,
        input.action,
        input.fromPeerDeviceId ?? null,
        input.toPeerDeviceId ?? null,
        input.status,
        input.detail ?? null,
        input.occurredAtMs,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  private async inferNextHop(
    ownerDeviceId: string,
    recipientDeviceId: string,
  ): Promise<string | undefined> {
    const db = await this.dbProvider();
    const direct = await db.execute(
      `
        SELECT peer_device_id AS peerDeviceId
        FROM sync_peers
        WHERE peer_device_id = ?
        LIMIT 1
      `,
      [recipientDeviceId],
    );

    if (direct.rows.length > 0) {
      return recipientDeviceId;
    }

    const relayCandidates = await db.execute(
      `
        SELECT
          sp.peer_device_id AS peerDeviceId,
          ms.relay_score AS relayScore
        FROM sync_peers sp
        LEFT JOIN mesh_node_state ms
          ON ms.device_id = sp.peer_device_id
        WHERE sp.peer_device_id != ?
        ORDER BY COALESCE(ms.relay_score, 0) DESC,
                 COALESCE(sp.last_seen_at_ms, 0) DESC,
                 sp.peer_device_id ASC
      `,
      [ownerDeviceId],
    );

    return asOptionalString(relayCandidates.rows[0]?.peerDeviceId);
  }

  private async getOrCreateRecipientPublicMeshKey(
    recipientDeviceId: string,
  ): Promise<Uint8Array> {
    const db = await this.dbProvider();
    const identityResult = await db.execute(
      `
        SELECT
          public_key_pem AS publicKeyPem,
          metadata_json AS metadataJson
        FROM device_identity
        WHERE device_id = ?
        LIMIT 1
      `,
      [recipientDeviceId],
    );

    const metadata = parseJsonRecord(identityResult.rows[0]?.metadataJson);
    const existingKey = asOptionalString(metadata.meshPublicKeyBase64);
    if (existingKey) {
      return base64ToBytes(existingKey);
    }

    const publicKeyPem = asOptionalString(identityResult.rows[0]?.publicKeyPem);
    if (!publicKeyPem) {
      throw new Error(
        `Recipient device ${recipientDeviceId} is missing a provisioned M1 identity key.`,
      );
    }

    const derivedPublicKey = deriveMeshPublicKeyFromEd25519PublicPem(publicKeyPem);

    const nextMetadata = {
      ...metadata,
      meshPublicKeyBase64: bytesToBase64(derivedPublicKey),
      meshKeyOrigin: 'm1-ed25519-derived',
    };

    await db.execute(
      `
        UPDATE device_identity
        SET metadata_json = ?
        WHERE device_id = ?
      `,
      [JSON.stringify(nextMetadata), recipientDeviceId],
    );

    return derivedPublicKey;
  }

  private async getMeshKeyPairForLocalDevice(deviceId: string): Promise<{
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }> {
    const keyMaterial = await this.services.keyVault.get(deviceId);
    if (keyMaterial?.meshPublicKeyBase64 && keyMaterial.meshSecretKeyBase64) {
      return {
        publicKey: base64ToBytes(keyMaterial.meshPublicKeyBase64),
        secretKey: base64ToBytes(keyMaterial.meshSecretKeyBase64),
      };
    }

    if (!keyMaterial) {
      throw new Error(
        `Device ${deviceId} has no local M1 key material; cannot derive mesh encryption keys.`,
      );
    }

    const derived = deriveMeshKeyPairFromIdentity({
      publicKeyPem: keyMaterial.publicKeyPem,
      secretKeyHex: keyMaterial.secretKeyHex,
    });
    const meshPublicKeyBase64 = bytesToBase64(derived.publicKey);
    const meshSecretKeyBase64 = bytesToBase64(derived.secretKey);

    await this.services.keyVault.set(deviceId, {
      ...keyMaterial,
      meshPublicKeyBase64,
      meshSecretKeyBase64,
    });

    const db = await this.dbProvider();
    const identityResult = await db.execute(
      `
        SELECT metadata_json AS metadataJson
        FROM device_identity
        WHERE device_id = ?
        LIMIT 1
      `,
      [deviceId],
    );
    const metadata = parseJsonRecord(identityResult.rows[0]?.metadataJson);
    await db.execute(
      `
        UPDATE device_identity
        SET metadata_json = ?
        WHERE device_id = ?
      `,
      [
        JSON.stringify({
          ...metadata,
          meshPublicKeyBase64,
          meshKeyOrigin: 'm1-ed25519-derived',
        }),
        deviceId,
      ],
    );

    return {
      publicKey: derived.publicKey,
      secretKey: derived.secretKey,
    };
  }
}

function computeRelayScore(input: {
  batteryPercent: number;
  signalStrength: number;
  nearbyPeerCount: number;
  proximityScore: number;
}): number {
  const battery = Math.max(0, Math.min(100, input.batteryPercent));
  const signal = Math.max(0, Math.min(100, input.signalStrength));
  const peers = Math.max(0, input.nearbyPeerCount);
  const proximity = Math.max(0, Math.min(100, input.proximityScore));

  const score = battery * 0.25 + signal * 0.35 + peers * 12 + proximity * 0.1;

  if (battery < 30) {
    return score * 0.35;
  }

  if (signal < 25) {
    return score * 0.55;
  }

  return Math.min(100, score);
}

function createIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asString(value: Scalar | unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '';
}

function asNumber(value: Scalar | unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function asOptionalString(value: Scalar | unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBlob(value: Scalar | unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return undefined;
}

function parseJsonRecord(value: Scalar | unknown): Record<string, string> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object') {
      const result: Record<string, string> = {};
      for (const [key, maybeValue] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof maybeValue === 'string') {
          result[key] = maybeValue;
        }
      }
      return result;
    }
  } catch {
    return {};
  }

  return {};
}