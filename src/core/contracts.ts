import type { VectorClockMap } from './crdt';

export type AppRole =
  | 'FIELD_VOLUNTEER'
  | 'SUPPLY_MANAGER'
  | 'DRONE_OPERATOR'
  | 'CAMP_COMMANDER'
  | 'SYNC_ADMIN';

export type PermissionAction = 'read' | 'write' | 'execute';

export type LedgerEntityKind =
  | 'device'
  | 'user'
  | 'supply_item'
  | 'delivery'
  | 'route'
  | 'receipt'
  | 'handoff'
  | 'triage_decision'
  | 'edge_status';

export type LedgerEventKind =
  | 'auth'
  | 'inventory_mutation'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'route_updated'
  | 'pod_receipt'
  | 'handoff'
  | 'triage_decision'
  | 'mesh_role_changed'
  | 'edge_risk_updated';

export type RouteMode = 'truck' | 'speedboat' | 'drone';

export type PriorityTier = 'P0' | 'P1' | 'P2' | 'P3';

export type ConflictResolutionChoice = 'local' | 'remote' | 'merged' | 'manual';

export type ActorInput = {
  userId: string;
  deviceId: string;
  role: AppRole;
  displayName?: string;
};

export type DeviceIdentityRecord = {
  deviceId: string;
  userId: string;
  publicKeyPem: string;
  keyAlgorithm: 'RSA_2048' | 'ED25519';
  keyFingerprint: string;
  roles: AppRole[];
  provisionedAtMs: number;
};

export type AuthSessionRecord = {
  otpSessionId: string;
  userId: string;
  deviceId: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type PermissionCheckInput = {
  actor: ActorInput;
  resource: LedgerEntityKind;
  action: PermissionAction;
};

export type LedgerAppendInput = {
  eventId: string;
  entityType: LedgerEntityKind;
  entityId: string;
  eventType: LedgerEventKind;
  actor: ActorInput;
  occurredAtMs: number;
  vectorClock: VectorClockMap;
  payloadType: string;
  payloadBlob?: Uint8Array;
  metadata?: Record<string, unknown>;
};

export type LedgerDeltaRequest = {
  peerDeviceId: string;
  lastKnownClock: VectorClockMap;
  lastEventId?: string;
};

export type ConflictRecordInput = {
  conflictId: string;
  entityType: LedgerEntityKind;
  entityId: string;
  fieldName: string;
  localValue: Uint8Array | null;
  remoteValue: Uint8Array | null;
  createdAtMs: number;
};

export type RouteRequest = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: RouteMode;
  originNodeId: string;
  destinationNodeId: string;
  blockedEdgeIds?: string[];
  payloadWeightGrams?: number;
};

export type EdgeStatusUpdate = {
  edgeId: string;
  status: 'open' | 'degraded' | 'washed_out' | 'impassable' | 'high_risk';
  riskScore?: number;
  travelTimeMinutes?: number;
  updatedAtMs: number;
  reason:
    | 'manual_override'
    | 'edge_status_changed'
    | 'predicted_decay'
    | 'handoff_required'
    | 'sla_preemption';
};

export type RouteLegDto = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: 'road' | 'waterway' | 'airway';
  vehicleType: RouteMode;
  etaMinutes: number;
  riskScore: number;
};

export type RoutePlanDto = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: RouteMode;
  legs: RouteLegDto[];
  totalEtaMinutes: number;
  totalRiskScore: number;
  blockedEdgeIds: string[];
  handoffNodeIds: string[];
  requiresHandoff: boolean;
  computedAtMs: number;
};

export type SlaEvaluationInput = {
  deliveryId: string;
  priorityTier: PriorityTier;
  currentEtaMinutes: number;
  baselineEtaMinutes: number;
  slaDeadlineMs: number;
  nowMs: number;
};

export type TriageDecisionDto = {
  decisionId: string;
  deliveryId: string;
  highestRemainingPriority: PriorityTier;
  preempted: boolean;
  droppedCargoIds: string[];
  safeWaypointNodeId?: string;
  rationale: string;
  decidedAtMs: number;
};

export interface AuthService {
  provisionDeviceIdentity(input: {
    userId: string;
    deviceId: string;
    displayName: string;
    roles: AppRole[];
  }): Promise<DeviceIdentityRecord>;
  issueOfflineOtp(input: {
    userId: string;
    deviceId: string;
    issuedAtMs: number;
  }): Promise<AuthSessionRecord>;
  verifyOfflineOtp(input: {
    otpSessionId: string;
    code: string;
    verifiedAtMs: number;
  }): Promise<{ verified: boolean; authEventId: string }>;
  hasPermission(input: PermissionCheckInput): Promise<boolean>;
}

export interface LedgerService {
  appendEvent(input: LedgerAppendInput): Promise<void>;
  appendEvents(inputs: LedgerAppendInput[]): Promise<void>;
  getDeltaSince(request: LedgerDeltaRequest): Promise<LedgerAppendInput[]>;
  recordConflict(input: ConflictRecordInput): Promise<void>;
  resolveConflict(input: {
    conflictId: string;
    resolution: ConflictResolutionChoice;
    resolvedAtMs: number;
  }): Promise<void>;
}

export interface RoutingService {
  computeRoutePlan(request: RouteRequest): Promise<RoutePlanDto>;
  updateEdgeStatus(update: EdgeStatusUpdate): Promise<void>;
  recomputeAffectedRoutes(edgeId: string): Promise<RoutePlanDto[]>;
}

export interface TriageService {
  evaluateSlaBreach(input: SlaEvaluationInput): Promise<{
    breached: boolean;
    slowedByPercent: number;
  }>;
  decidePreemption(input: {
    deliveryId: string;
    cargoIdsByPriority: Record<PriorityTier, string[]>;
    safeWaypointNodeId?: string;
    nowMs: number;
  }): Promise<TriageDecisionDto>;
}
