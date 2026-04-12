import type {
  ConflictPayload,
  HandoffEventPayload,
  PodReceiptPayload,
  RouteResultPayload,
} from './payload-contracts';
import type {
  DashboardScreenData,
  DeliveryDetailsScreenData,
  HandoffFlowScreenData,
  LoginScreenData,
  PodVerificationState,
  RouteDetailsScreenData,
  SyncStatusScreenData,
} from './screen-contracts';

export type SeededScenarioScreen =
  | 'Login'
  | 'Dashboard'
  | 'RouteDetails'
  | 'DeliveryDetails'
  | 'SyncStatus'
  | 'HandoffFlow';

export type SeededScenarioVariant =
  | 'offline-baseline'
  | 'syncing-live'
  | 'conflict-detected'
  | 'verified-final';

export type SeededPodOutcome = {
  state: PodVerificationState;
  status: PodReceiptPayload['status'];
  rejectionCode?: string;
  rejectionReason?: string;
};

export type SeededDemoStep = {
  order: number;
  stepId: string;
  title: string;
  targetScreen: SeededScenarioScreen;
  variant: SeededScenarioVariant;
  objective: string;
};

export type SeededDemoScenario = {
  scenarioId: string;
  version: string;
  region: string;
  seededAtMs: number;
  offlineCapable: boolean;
  login: LoginScreenData;
  dashboardByVariant: Record<SeededScenarioVariant, DashboardScreenData>;
  routeDetails: RouteDetailsScreenData;
  deliveryDetails: DeliveryDetailsScreenData;
  syncStatusByVariant: Record<SeededScenarioVariant, SyncStatusScreenData>;
  handoffFlow: HandoffFlowScreenData;
  payloadFixtures: {
    routeResult: RouteResultPayload;
    conflict: ConflictPayload;
    podReceipt: PodReceiptPayload;
    handoffEvent: HandoffEventPayload;
  };
  podOutcomes: SeededPodOutcome[];
  demoScript: SeededDemoStep[];
};

const BASE_TIME_MS = Date.parse('2026-04-12T08:00:00.000Z');

const seededLogin: LoginScreenData = {
  userId: 'USR_VOL_A01',
  displayName: 'Amina Rahman',
  primaryRole: 'Field Volunteer',
  roles: ['Field Volunteer', 'Sync Admin'],
  keyProvisioned: true,
  keyAlgorithm: 'ed25519',
  keyFingerprint: '4f7ad4d2f0219e8a1d03f3c6bb8aacc9',
  lastLoginAtMs: BASE_TIME_MS - 15 * 60 * 1000,
};

const routeResultFixture: RouteResultPayload = {
  routeId: 'RTE_SYL_001',
  deliveryId: 'DLV_1001',
  vehicleId: 'VEH_BOAT_01',
  vehicleType: 'boat',
  totalEtaMinutes: 92,
  totalRiskScore: 0.62,
  blockedEdgeIds: ['E2'],
  handoffNodeIds: ['N4'],
  predictedFailureProbability: 0.78,
  updateReason: 'Road edge E2 flooded. Shifted to waterway route.',
  computedAtMs: BASE_TIME_MS - 5 * 60 * 1000,
  legs: [
    {
      legId: 'LEG_1',
      fromNodeId: 'N1',
      toNodeId: 'N3',
      edgeId: 'E6',
      edgeType: 'waterway',
      vehicleType: 'boat',
      etaMinutes: 52,
      riskScore: 0.49,
      status: 'active',
    },
    {
      legId: 'LEG_2',
      fromNodeId: 'N3',
      toNodeId: 'N4',
      edgeId: 'E7',
      edgeType: 'waterway',
      vehicleType: 'boat',
      etaMinutes: 40,
      riskScore: 0.73,
      status: 'planned',
    },
  ],
};

const conflictFixture: ConflictPayload = {
  conflictId: 'CFL_9001',
  conflictType: 'lww_register_conflict',
  entityType: 'supply_inventory',
  entityId: 'INV_ORS_01',
  fieldName: 'quantity',
  localValue: {
    encoding: 'number',
    value: 120,
  },
  remoteValue: {
    encoding: 'number',
    value: 95,
  },
  resolution: 'manual_override',
  resolutionText: 'Camp commander confirmed 95 units after recount.',
  resolutionEventId: 'LED_EVT_4401',
  createdAtMs: BASE_TIME_MS - 9 * 60 * 1000,
  resolvedAtMs: BASE_TIME_MS - 2 * 60 * 1000,
};

const podReceiptFixture: PodReceiptPayload = {
  receiptId: 'POD_REC_7001',
  challengeId: 'POD_CHLG_7001',
  deliveryId: 'DLV_1001',
  status: 'verified',
  senderUserId: 'USR_VOL_A01',
  senderDeviceId: 'DEV_A01',
  senderPublicKeyId: 'PK_A01_V1',
  recipientUserId: 'USR_CAMP_02',
  recipientDeviceId: 'DEV_CAMP_02',
  nonceHash: '6b9f3e9b1e85a1df4f9d7b1a68c6203a',
  payloadHash: 'cda75d2e13a04f32e2d1a8f5b7d63fd2',
  issuedAtMs: BASE_TIME_MS - 7 * 60 * 1000,
  expiresAtMs: BASE_TIME_MS + 8 * 60 * 1000,
  verifiedAtMs: BASE_TIME_MS - 4 * 60 * 1000,
  ledgerEventId: 'LED_EVT_5503',
};

const handoffEventFixture: HandoffEventPayload = {
  handoffId: 'HND_3001',
  deliveryId: 'DLV_1001',
  sourceVehicleId: 'VEH_BOAT_01',
  sourceVehicleType: 'boat',
  targetVehicleId: 'VEH_DRONE_03',
  targetVehicleType: 'drone',
  rendezvous: {
    latitude: 24.8932,
    longitude: 91.8688,
  },
  cargoIds: ['CRG_MED_01', 'CRG_ORS_03'],
  receiptId: 'POD_REC_7001',
  status: 'ownership_transferred',
  occurredAtMs: BASE_TIME_MS - 1 * 60 * 1000,
  ownershipTransferEventId: 'LED_EVT_6602',
};

const routeDetails: RouteDetailsScreenData = {
  routeId: routeResultFixture.routeId,
  deliveryId: routeResultFixture.deliveryId,
  vehicleId: routeResultFixture.vehicleId,
  vehicleType: routeResultFixture.vehicleType,
  totalEtaMinutes: routeResultFixture.totalEtaMinutes,
  totalRiskScore: routeResultFixture.totalRiskScore,
  blockedEdgeIds: routeResultFixture.blockedEdgeIds,
  handoffNodeIds: routeResultFixture.handoffNodeIds,
  legs: routeResultFixture.legs,
  predictedFailureProbability: routeResultFixture.predictedFailureProbability,
  computedAtMs: routeResultFixture.computedAtMs,
  nodes: [
    {
      nodeId: 'N1',
      displayName: 'Sylhet Warehouse',
      nodeType: 'warehouse',
      latitude: 24.8949,
      longitude: 91.8687,
      isActive: true,
    },
    {
      nodeId: 'N3',
      displayName: 'River Gate Alpha',
      nodeType: 'rendezvous',
      latitude: 24.8874,
      longitude: 91.8601,
      isActive: true,
    },
    {
      nodeId: 'N4',
      displayName: 'Camp Delta 12',
      nodeType: 'camp',
      latitude: 24.8722,
      longitude: 91.852,
      isActive: true,
    },
  ],
  edges: [
    {
      edgeId: 'E2',
      sourceNodeId: 'N1',
      targetNodeId: 'N3',
      edgeType: 'road',
      status: 'washed_out',
      travelTimeMinutes: 9999,
      riskScore: 0.98,
      updatedAtMs: BASE_TIME_MS - 10 * 60 * 1000,
    },
    {
      edgeId: 'E6',
      sourceNodeId: 'N1',
      targetNodeId: 'N3',
      edgeType: 'waterway',
      status: 'open',
      travelTimeMinutes: 52,
      riskScore: 0.49,
      updatedAtMs: BASE_TIME_MS - 5 * 60 * 1000,
    },
    {
      edgeId: 'E7',
      sourceNodeId: 'N3',
      targetNodeId: 'N4',
      edgeType: 'waterway',
      status: 'open',
      travelTimeMinutes: 40,
      riskScore: 0.73,
      updatedAtMs: BASE_TIME_MS - 5 * 60 * 1000,
    },
  ],
  vehicle: {
    vehicleId: 'VEH_BOAT_01',
    displayName: 'Rescue Boat 01',
    vehicleType: 'boat',
    status: 'en_route',
    latitude: 24.8889,
    longitude: 91.8625,
    batteryPercent: 64,
  },
  predictions: [
    {
      edgeId: 'E7',
      probability: 0.78,
      threshold: 0.7,
      features: {
        rainfall_rate_mm_per_hr: 43,
        cumulative_rainfall_mm: 192,
        soil_saturation_proxy: 0.82,
      },
      predictedAtMs: BASE_TIME_MS - 6 * 60 * 1000,
      modelVersion: 'route-decay-v1',
    },
  ],
};

const deliveryDetails: DeliveryDetailsScreenData = {
  deliveryId: 'DLV_1001',
  originNodeId: 'N1',
  destinationNodeId: 'N4',
  assignedVehicleId: 'VEH_BOAT_01',
  priorityTier: 'P0',
  status: 'in_transit',
  podState: 'verification-success',
  cargoItems: [
    {
      cargoId: 'CRG_MED_01',
      itemName: 'Antivenom Kit',
      category: 'medical',
      quantity: 12,
      unit: 'box',
      priorityTier: 'P0',
      slaDeadlineMs: BASE_TIME_MS + 2 * 60 * 60 * 1000,
      status: 'in_transit',
      weightGrams: 5400,
      dropAllowed: false,
    },
    {
      cargoId: 'CRG_ORS_03',
      itemName: 'ORS Pack',
      category: 'relief',
      quantity: 95,
      unit: 'unit',
      priorityTier: 'P2',
      slaDeadlineMs: BASE_TIME_MS + 24 * 60 * 60 * 1000,
      status: 'in_transit',
      weightGrams: 1800,
      dropAllowed: true,
    },
  ],
  latestReceipt: {
    receiptId: podReceiptFixture.receiptId,
    challengeId: podReceiptFixture.challengeId,
    status: podReceiptFixture.status,
    senderDeviceId: podReceiptFixture.senderDeviceId,
    recipientDeviceId: podReceiptFixture.recipientDeviceId,
    issuedAtMs: podReceiptFixture.issuedAtMs,
    expiresAtMs: podReceiptFixture.expiresAtMs,
    verifiedAtMs: podReceiptFixture.verifiedAtMs,
    rejectionCode: podReceiptFixture.rejectionCode,
    rejectionReason: podReceiptFixture.rejectionReason,
  },
  ledgerEventIds: ['LED_EVT_5501', 'LED_EVT_5502', 'LED_EVT_5503'],
};

const handoffFlow: HandoffFlowScreenData = {
  deliveryId: 'DLV_1001',
  requiresHandoff: true,
  routeId: 'RTE_SYL_001',
  handoffNodeIds: ['N4'],
  state: 'ownership-transferred',
  sourceVehicle: {
    vehicleId: 'VEH_BOAT_01',
    displayName: 'Rescue Boat 01',
    vehicleType: 'boat',
    status: 'at_rendezvous',
    latitude: 24.8932,
    longitude: 91.8688,
    batteryPercent: 64,
  },
  targetVehicle: {
    vehicleId: 'VEH_DRONE_03',
    displayName: 'Relief Drone 03',
    vehicleType: 'drone',
    status: 'payload_received',
    latitude: 24.8932,
    longitude: 91.8688,
    batteryPercent: 47,
  },
  event: {
    handoffId: handoffEventFixture.handoffId,
    deliveryId: handoffEventFixture.deliveryId,
    sourceVehicleId: handoffEventFixture.sourceVehicleId,
    sourceVehicleType: handoffEventFixture.sourceVehicleType,
    targetVehicleId: handoffEventFixture.targetVehicleId,
    targetVehicleType: handoffEventFixture.targetVehicleType,
    rendezvousLatitude: handoffEventFixture.rendezvous.latitude,
    rendezvousLongitude: handoffEventFixture.rendezvous.longitude,
    cargoIds: handoffEventFixture.cargoIds,
    receiptId: handoffEventFixture.receiptId,
    status: handoffEventFixture.status,
    occurredAtMs: handoffEventFixture.occurredAtMs,
  },
  ownershipTransferEventIds: ['LED_EVT_6601', 'LED_EVT_6602'],
};

const dashboardOfflineBaseline: DashboardScreenData = {
  connectivityState: 'offline',
  routes: [
    {
      deliveryId: 'DLV_1001',
      routeId: 'RTE_SYL_001',
      priorityTier: 'P0',
      status: 'in_transit',
      etaMinutes: 92,
      totalRiskScore: 0.62,
      requiresHandoff: true,
      computedAtMs: BASE_TIME_MS - 5 * 60 * 1000,
    },
  ],
  supplies: [
    {
      inventoryItemId: 'INV_ORS_01',
      itemName: 'ORS Pack',
      category: 'relief',
      quantity: 120,
      unit: 'unit',
      storageNodeId: 'N1',
      status: 'available',
      updatedAtMs: BASE_TIME_MS - 12 * 60 * 1000,
    },
  ],
  nodeHealth: [
    {
      vehicleId: 'VEH_BOAT_01',
      vehicleType: 'boat',
      status: 'en_route',
      batteryPercent: 64,
      currentNodeId: 'N3',
      lastSeenAtMs: BASE_TIME_MS - 3 * 60 * 1000,
    },
  ],
  triageAlerts: [
    {
      deliveryId: 'DLV_1001',
      highestRemainingPriority: 'P0',
      preempted: true,
      safeWaypointNodeId: 'N3',
      rationale: 'Route slowdown above 30%; drop P2 cargo for P0 SLA.',
      decidedAtMs: BASE_TIME_MS - 8 * 60 * 1000,
    },
  ],
  conflicts: [],
  sync: {
    peerCount: 0,
    queuedEnvelopeCount: 0,
    inFlightEnvelopeCount: 0,
  },
};

const dashboardSyncingLive: DashboardScreenData = {
  ...dashboardOfflineBaseline,
  connectivityState: 'syncing',
  sync: {
    peerCount: 2,
    queuedEnvelopeCount: 3,
    inFlightEnvelopeCount: 1,
    lastSyncedAtMs: BASE_TIME_MS - 60 * 1000,
  },
};

const dashboardConflictDetected: DashboardScreenData = {
  ...dashboardSyncingLive,
  connectivityState: 'conflict-detected',
  conflicts: [
    {
      conflictId: conflictFixture.conflictId,
      entityType: conflictFixture.entityType,
      entityId: conflictFixture.entityId,
      fieldName: conflictFixture.fieldName,
      resolutionText: undefined,
      createdAtMs: conflictFixture.createdAtMs,
      resolvedAtMs: undefined,
    },
  ],
};

const dashboardVerifiedFinal: DashboardScreenData = {
  ...dashboardSyncingLive,
  connectivityState: 'verified',
  conflicts: [
    {
      conflictId: conflictFixture.conflictId,
      entityType: conflictFixture.entityType,
      entityId: conflictFixture.entityId,
      fieldName: conflictFixture.fieldName,
      resolutionText: conflictFixture.resolutionText,
      createdAtMs: conflictFixture.createdAtMs,
      resolvedAtMs: conflictFixture.resolvedAtMs,
    },
  ],
  sync: {
    peerCount: 2,
    queuedEnvelopeCount: 0,
    inFlightEnvelopeCount: 0,
    lastSyncedAtMs: BASE_TIME_MS,
  },
};

const syncOfflineBaseline: SyncStatusScreenData = {
  phase: 'discovering',
  peers: [],
  outbox: [],
  unresolvedConflictCount: 0,
  recentLedgerEventIds: ['LED_EVT_5501'],
};

const syncSyncingLive: SyncStatusScreenData = {
  phase: 'exchanging',
  peers: [
    {
      peerDeviceId: 'DEV_B02',
      transport: 'ble',
      lastEnvelopeId: 'ENV_4009',
      lastEventId: 'LED_EVT_4498',
      supportedCapabilities: ['delta-sync', 'ack', 'resume'],
      lastSyncedAtMs: BASE_TIME_MS - 90 * 1000,
      lastSeenAtMs: BASE_TIME_MS - 30 * 1000,
    },
    {
      peerDeviceId: 'DEV_C03',
      transport: 'ble',
      lastEnvelopeId: 'ENV_4010',
      lastEventId: 'LED_EVT_4502',
      supportedCapabilities: ['delta-sync', 'ack'],
      lastSyncedAtMs: BASE_TIME_MS - 2 * 60 * 1000,
      lastSeenAtMs: BASE_TIME_MS - 45 * 1000,
    },
  ],
  outbox: [
    {
      envelopeId: 'ENV_4011',
      recipientDeviceId: 'DEV_B02',
      transport: 'ble',
      status: 'awaiting_ack',
      ttlHops: 4,
      hopCount: 1,
      createdAtMs: BASE_TIME_MS - 75 * 1000,
      sentAtMs: BASE_TIME_MS - 70 * 1000,
    },
  ],
  unresolvedConflictCount: 0,
  recentLedgerEventIds: ['LED_EVT_5501', 'LED_EVT_5502'],
};

const syncConflictDetected: SyncStatusScreenData = {
  ...syncSyncingLive,
  phase: 'applying',
  unresolvedConflictCount: 1,
};

const syncVerifiedFinal: SyncStatusScreenData = {
  ...syncSyncingLive,
  phase: 'complete',
  outbox: [],
  unresolvedConflictCount: 0,
  recentLedgerEventIds: ['LED_EVT_5501', 'LED_EVT_5502', 'LED_EVT_5503'],
};

export const SEEDED_DEMO_SCENARIO: SeededDemoScenario = {
  scenarioId: 'sylhet-flash-flood-v1',
  version: '1.0.0',
  region: 'Sylhet Division',
  seededAtMs: BASE_TIME_MS,
  offlineCapable: true,
  login: seededLogin,
  dashboardByVariant: {
    'offline-baseline': dashboardOfflineBaseline,
    'syncing-live': dashboardSyncingLive,
    'conflict-detected': dashboardConflictDetected,
    'verified-final': dashboardVerifiedFinal,
  },
  routeDetails,
  deliveryDetails,
  syncStatusByVariant: {
    'offline-baseline': syncOfflineBaseline,
    'syncing-live': syncSyncingLive,
    'conflict-detected': syncConflictDetected,
    'verified-final': syncVerifiedFinal,
  },
  handoffFlow,
  payloadFixtures: {
    routeResult: routeResultFixture,
    conflict: conflictFixture,
    podReceipt: podReceiptFixture,
    handoffEvent: handoffEventFixture,
  },
  podOutcomes: [
    {
      state: 'verification-success',
      status: 'verified',
    },
    {
      state: 'signature-mismatch',
      status: 'signature_mismatch',
      rejectionCode: 'SIG_MISMATCH',
      rejectionReason: 'Sender signature does not verify with known public key.',
    },
    {
      state: 'replay-rejected',
      status: 'replay_rejected',
      rejectionCode: 'NONCE_REUSED',
      rejectionReason: 'Challenge nonce already consumed on this device.',
    },
    {
      state: 'challenge-expired',
      status: 'expired',
      rejectionCode: 'EXPIRED_CHALLENGE',
      rejectionReason: 'Challenge timestamp is outside allowed verification window.',
    },
  ],
  demoScript: [
    {
      order: 1,
      stepId: 'login-offline',
      title: 'Offline Login and Role Load',
      targetScreen: 'Login',
      variant: 'offline-baseline',
      objective: 'Show offline auth identity and role context is available.',
    },
    {
      order: 2,
      stepId: 'dashboard-offline',
      title: 'Dashboard Offline State',
      targetScreen: 'Dashboard',
      variant: 'offline-baseline',
      objective: 'Show route/supply/triage panels while disconnected.',
    },
    {
      order: 3,
      stepId: 'route-visualization',
      title: 'Route Recompute and Risk View',
      targetScreen: 'RouteDetails',
      variant: 'offline-baseline',
      objective: 'Show blocked edge overlay and predicted-risk leg highlight.',
    },
    {
      order: 4,
      stepId: 'pod-verification',
      title: 'PoD Verification Outcome',
      targetScreen: 'DeliveryDetails',
      variant: 'verified-final',
      objective: 'Show QR challenge resolution and countersigned receipt.',
    },
    {
      order: 5,
      stepId: 'mesh-sync-live',
      title: 'Mesh Sync Progress',
      targetScreen: 'SyncStatus',
      variant: 'syncing-live',
      objective: 'Show peer discovery, envelope transfer, and ack progress.',
    },
    {
      order: 6,
      stepId: 'conflict-and-resolution',
      title: 'Conflict Detected and Resolved',
      targetScreen: 'Dashboard',
      variant: 'conflict-detected',
      objective: 'Show conflict card with both values and final resolution path.',
    },
    {
      order: 7,
      stepId: 'handoff-finalization',
      title: 'Boat to Drone Handoff',
      targetScreen: 'HandoffFlow',
      variant: 'verified-final',
      objective: 'Show rendezvous, ownership transfer, and ledger proof linkage.',
    },
  ],
};

export function getSeededDemoScenario(): SeededDemoScenario {
  return SEEDED_DEMO_SCENARIO;
}

export function getSeededDashboardData(
  variant: SeededScenarioVariant,
): DashboardScreenData {
  return SEEDED_DEMO_SCENARIO.dashboardByVariant[variant];
}

export function getSeededSyncStatusData(
  variant: SeededScenarioVariant,
): SyncStatusScreenData {
  return SEEDED_DEMO_SCENARIO.syncStatusByVariant[variant];
}
