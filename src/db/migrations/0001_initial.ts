import type { Migration } from '../types';

export const initialMigration: Migration = {
  id: 1,
  name: 'initial_core_schema',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at_ms INTEGER NOT NULL
      )
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        primary_role TEXT NOT NULL,
        roles_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        last_login_at_ms INTEGER
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS device_identity (
        device_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        key_algorithm TEXT NOT NULL,
        key_fingerprint TEXT NOT NULL,
        roles_json TEXT NOT NULL DEFAULT '[]',
        provisioned_at_ms INTEGER NOT NULL,
        last_rotated_at_ms INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS auth_audit_log (
        log_id TEXT PRIMARY KEY,
        auth_event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        user_id TEXT,
        device_id TEXT,
        otp_session_id TEXT,
        otp_issued_at_ms INTEGER,
        otp_expires_at_ms INTEGER,
        key_fingerprint TEXT,
        failure_reason TEXT,
        previous_hash BLOB,
        payload_hash BLOB,
        current_hash BLOB NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        event_blob BLOB,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS network_nodes (
        node_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        node_type TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        updated_at_ms INTEGER NOT NULL
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS route_edges (
        edge_id TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        status TEXT NOT NULL,
        travel_time_minutes INTEGER NOT NULL,
        capacity_units INTEGER NOT NULL DEFAULT 0,
        risk_score REAL NOT NULL DEFAULT 0,
        last_update_reason TEXT,
        updated_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS vehicles (
        vehicle_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        vehicle_type TEXT NOT NULL,
        capacity_units INTEGER NOT NULL DEFAULT 0,
        payload_limit_grams INTEGER NOT NULL DEFAULT 0,
        battery_percent INTEGER,
        current_node_id TEXT,
        latitude REAL,
        longitude REAL,
        status TEXT NOT NULL DEFAULT 'idle',
        assigned_delivery_id TEXT,
        last_seen_at_ms INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS supply_inventory (
        inventory_item_id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit TEXT NOT NULL,
        storage_node_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        vector_clock_json TEXT NOT NULL DEFAULT '{}',
        last_mutation_event_id TEXT,
        updated_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS deliveries (
        delivery_id TEXT PRIMARY KEY,
        origin_node_id TEXT NOT NULL,
        destination_node_id TEXT NOT NULL,
        assigned_vehicle_id TEXT,
        assigned_vehicle_type TEXT,
        priority_tier TEXT NOT NULL,
        status TEXT NOT NULL,
        eta_minutes INTEGER,
        current_route_id TEXT,
        requires_handoff INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS cargo_items (
        cargo_id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        inventory_item_id TEXT,
        item_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit TEXT NOT NULL,
        priority_tier TEXT NOT NULL,
        sla_deadline_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        weight_grams INTEGER NOT NULL DEFAULT 0,
        drop_allowed INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS route_plans (
        route_id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        vehicle_type TEXT NOT NULL,
        total_eta_minutes INTEGER NOT NULL,
        total_risk_score REAL NOT NULL DEFAULT 0,
        blocked_edge_ids_json TEXT NOT NULL DEFAULT '[]',
        handoff_node_ids_json TEXT NOT NULL DEFAULT '[]',
        legs_json TEXT NOT NULL DEFAULT '[]',
        update_reason TEXT,
        predicted_failure_probability REAL,
        requires_handoff INTEGER NOT NULL DEFAULT 0,
        computed_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS route_predictions (
        prediction_id TEXT PRIMARY KEY,
        edge_id TEXT NOT NULL,
        probability REAL NOT NULL,
        threshold REAL NOT NULL,
        features_json TEXT NOT NULL DEFAULT '{}',
        predicted_at_ms INTEGER NOT NULL,
        model_version TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS pod_receipts (
        receipt_id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        challenge_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        sender_device_id TEXT NOT NULL,
        sender_user_id TEXT,
        sender_public_key_id TEXT NOT NULL,
        recipient_user_id TEXT,
        recipient_device_id TEXT,
        nonce BLOB NOT NULL,
        payload_hash BLOB NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        verified_at_ms INTEGER,
        rejection_code TEXT,
        rejection_reason TEXT,
        receipt_blob BLOB,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce_hash TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        receipt_id TEXT,
        consumed_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS handoff_events (
        handoff_id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        source_vehicle_id TEXT NOT NULL,
        source_vehicle_type TEXT NOT NULL,
        target_vehicle_id TEXT NOT NULL,
        target_vehicle_type TEXT NOT NULL,
        rendezvous_latitude REAL NOT NULL,
        rendezvous_longitude REAL NOT NULL,
        cargo_ids_json TEXT NOT NULL DEFAULT '[]',
        receipt_id TEXT,
        status TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        event_blob BLOB,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS triage_decisions (
        decision_id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        highest_remaining_priority TEXT NOT NULL,
        preempted INTEGER NOT NULL DEFAULT 0,
        dropped_cargo_ids_json TEXT NOT NULL DEFAULT '[]',
        safe_waypoint_node_id TEXT,
        rationale TEXT NOT NULL,
        decided_at_ms INTEGER NOT NULL,
        decision_blob BLOB,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS conflicts (
        conflict_id TEXT PRIMARY KEY,
        conflict_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        local_value_blob BLOB,
        remote_value_blob BLOB,
        resolution_text TEXT,
        resolution_event_id TEXT,
        created_at_ms INTEGER NOT NULL,
        resolved_at_ms INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS ledger_events (
        event_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_user_id TEXT,
        actor_device_id TEXT,
        actor_role TEXT,
        occurred_at_ms INTEGER NOT NULL,
        vector_clock_json TEXT NOT NULL DEFAULT '{}',
        audit_previous_hash BLOB,
        audit_payload_hash BLOB,
        audit_current_hash BLOB,
        payload_type TEXT,
        payload_blob BLOB,
        schema_version TEXT NOT NULL DEFAULT 'digitaldelta.v1',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS sync_peers (
        peer_device_id TEXT PRIMARY KEY,
        transport TEXT NOT NULL,
        last_envelope_id TEXT,
        last_event_id TEXT,
        last_vector_clock_json TEXT NOT NULL DEFAULT '{}',
        supported_capabilities_json TEXT NOT NULL DEFAULT '[]',
        last_synced_at_ms INTEGER,
        last_seen_at_ms INTEGER,
        schema_version TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS sync_outbox (
        envelope_id TEXT PRIMARY KEY,
        recipient_device_id TEXT NOT NULL,
        transport TEXT NOT NULL,
        status TEXT NOT NULL,
        dedup_key TEXT NOT NULL,
        ttl_hops INTEGER NOT NULL,
        hop_count INTEGER NOT NULL DEFAULT 0,
        requires_ack INTEGER NOT NULL DEFAULT 1,
        created_at_ms INTEGER NOT NULL,
        available_after_ms INTEGER,
        expires_at_ms INTEGER,
        sent_at_ms INTEGER,
        acked_at_ms INTEGER,
        payload_blob BLOB NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_users_primary_role ON users(primary_role)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_auth_audit_log_user_id ON auth_audit_log(user_id, occurred_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_auth_audit_log_device_id ON auth_audit_log(device_id, occurred_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_route_edges_source_target ON route_edges(source_node_id, target_node_id)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_route_edges_status ON route_edges(status)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_vehicles_type_status ON vehicles(vehicle_type, status)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_supply_inventory_storage_node ON supply_inventory(storage_node_id)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_deliveries_priority_status ON deliveries(priority_tier, status)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_deliveries_vehicle ON deliveries(assigned_vehicle_id)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_cargo_items_delivery_priority ON cargo_items(delivery_id, priority_tier)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_route_plans_delivery ON route_plans(delivery_id, computed_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_route_predictions_edge_time ON route_predictions(edge_id, predicted_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_pod_receipts_delivery_status ON pod_receipts(delivery_id, status)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_handoff_events_delivery_time ON handoff_events(delivery_id, occurred_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_triage_decisions_delivery_time ON triage_decisions(delivery_id, decided_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_conflicts_entity ON conflicts(entity_type, entity_id, resolved_at_ms)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_ledger_events_entity_time ON ledger_events(entity_type, entity_id, occurred_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_ledger_events_type_time ON ledger_events(event_type, occurred_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_ledger_events_actor_device ON ledger_events(actor_device_id, occurred_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_sync_peers_last_synced ON sync_peers(last_synced_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_sync_outbox_recipient_status ON sync_outbox(recipient_device_id, status, created_at_ms)',
    ],
    [
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_dedup_key ON sync_outbox(dedup_key)',
    ],
  ],
};
