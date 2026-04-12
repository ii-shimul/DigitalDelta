export type ConnectivityState =
  | 'offline'
  | 'syncing'
  | 'verified'
  | 'conflict-detected';

export type SyncPhase =
  | 'discovering'
  | 'exchanging'
  | 'applying'
  | 'complete'
  | 'failed';

export type PodVerificationState =
  | 'challenge-generated'
  | 'verification-success'
  | 'signature-mismatch'
  | 'replay-rejected'
  | 'challenge-expired';

export type HandoffFlowState =
  | 'drone-required'
  | 'rendezvous-pending'
  | 'handoff-confirmed'
  | 'ownership-transferred'
  | 'handoff-failed';

export type LoginScreenData = {
  userId: string;
  displayName: string;
  primaryRole: string;
  roles: string[];
  keyProvisioned: boolean;
  keyAlgorithm?: string;
  keyFingerprint?: string;
  lastLoginAtMs?: number;
  authFailureReason?: string;
};

export type DashboardRouteSummary = {
  deliveryId: string;
  routeId?: string;
  priorityTier: string;
  status: string;
  etaMinutes?: number;
  totalRiskScore?: number;
  requiresHandoff: boolean;
  computedAtMs?: number;
};

export type DashboardSupplySummary = {
  inventoryItemId: string;
  itemName: string;
  category: string;
  quantity: number;
  unit: string;
  storageNodeId: string;
  status: string;
  updatedAtMs: number;
};

export type DashboardNodeHealth = {
  vehicleId: string;
  vehicleType: string;
  status: string;
  batteryPercent?: number;
  currentNodeId?: string;
  lastSeenAtMs?: number;
};

export type DashboardTriageAlert = {
  deliveryId: string;
  highestRemainingPriority: string;
  preempted: boolean;
  safeWaypointNodeId?: string;
  rationale: string;
  decidedAtMs: number;
};

export type DashboardConflictSummary = {
  conflictId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  resolutionText?: string;
  createdAtMs: number;
  resolvedAtMs?: number;
};

export type DashboardSyncSummary = {
  peerCount: number;
  queuedEnvelopeCount: number;
  inFlightEnvelopeCount: number;
  lastSyncedAtMs?: number;
};

export type DashboardScreenData = {
  connectivityState: ConnectivityState;
  routes: DashboardRouteSummary[];
  supplies: DashboardSupplySummary[];
  nodeHealth: DashboardNodeHealth[];
  triageAlerts: DashboardTriageAlert[];
  conflicts: DashboardConflictSummary[];
  sync: DashboardSyncSummary;
};

export type RouteNodeData = {
  nodeId: string;
  displayName: string;
  nodeType: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
};

export type RouteEdgeData = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  status: string;
  travelTimeMinutes: number;
  riskScore: number;
  updatedAtMs: number;
};

export type RouteVehicleData = {
  vehicleId: string;
  displayName: string;
  vehicleType: string;
  status: string;
  latitude?: number;
  longitude?: number;
  batteryPercent?: number;
};

export type RoutePredictionData = {
  edgeId: string;
  probability: number;
  threshold: number;
  features: Record<string, number | string | boolean>;
  predictedAtMs: number;
  modelVersion: string;
};

export type RouteDetailsScreenData = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: string;
  totalEtaMinutes: number;
  totalRiskScore: number;
  blockedEdgeIds: string[];
  handoffNodeIds: string[];
  legs: Array<Record<string, unknown>>;
  predictedFailureProbability?: number;
  computedAtMs: number;
  nodes: RouteNodeData[];
  edges: RouteEdgeData[];
  vehicle?: RouteVehicleData;
  predictions: RoutePredictionData[];
};

export type DeliveryCargoItem = {
  cargoId: string;
  itemName: string;
  category: string;
  quantity: number;
  unit: string;
  priorityTier: string;
  slaDeadlineMs: number;
  status: string;
  weightGrams: number;
  dropAllowed: boolean;
};

export type PodReceiptData = {
  receiptId: string;
  challengeId: string;
  status: string;
  senderDeviceId: string;
  recipientDeviceId?: string;
  issuedAtMs: number;
  expiresAtMs: number;
  verifiedAtMs?: number;
  rejectionCode?: string;
  rejectionReason?: string;
};

export type DeliveryDetailsScreenData = {
  deliveryId: string;
  originNodeId: string;
  destinationNodeId: string;
  assignedVehicleId?: string;
  priorityTier: string;
  status: string;
  podState: PodVerificationState;
  cargoItems: DeliveryCargoItem[];
  latestReceipt?: PodReceiptData;
  ledgerEventIds: string[];
};

export type SyncPeerData = {
  peerDeviceId: string;
  transport: string;
  lastEnvelopeId?: string;
  lastEventId?: string;
  supportedCapabilities: string[];
  lastSyncedAtMs?: number;
  lastSeenAtMs?: number;
};

export type SyncOutboxItemData = {
  envelopeId: string;
  recipientDeviceId: string;
  transport: string;
  status: string;
  ttlHops: number;
  hopCount: number;
  createdAtMs: number;
  availableAfterMs?: number;
  expiresAtMs?: number;
  sentAtMs?: number;
  ackedAtMs?: number;
};

export type SyncStatusScreenData = {
  phase: SyncPhase;
  peers: SyncPeerData[];
  outbox: SyncOutboxItemData[];
  unresolvedConflictCount: number;
  recentLedgerEventIds: string[];
};

export type HandoffEventData = {
  handoffId: string;
  deliveryId: string;
  sourceVehicleId: string;
  sourceVehicleType: string;
  targetVehicleId: string;
  targetVehicleType: string;
  rendezvousLatitude: number;
  rendezvousLongitude: number;
  cargoIds: string[];
  receiptId?: string;
  status: string;
  occurredAtMs: number;
};

export type HandoffFlowScreenData = {
  deliveryId: string;
  requiresHandoff: boolean;
  routeId?: string;
  handoffNodeIds: string[];
  state: HandoffFlowState;
  sourceVehicle?: RouteVehicleData;
  targetVehicle?: RouteVehicleData;
  event?: HandoffEventData;
  ownershipTransferEventIds: string[];
};
