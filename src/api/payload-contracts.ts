export type RouteLegPayload = {
  legId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeId: string;
  edgeType: 'road' | 'waterway' | 'airway';
  vehicleType: 'truck' | 'boat' | 'drone';
  etaMinutes: number;
  riskScore: number;
  status: 'planned' | 'active' | 'blocked' | 'completed';
};

export type RouteResultPayload = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: 'truck' | 'boat' | 'drone';
  totalEtaMinutes: number;
  totalRiskScore: number;
  blockedEdgeIds: string[];
  handoffNodeIds: string[];
  predictedFailureProbability?: number;
  updateReason?: string;
  computedAtMs: number;
  legs: RouteLegPayload[];
};

export type ConflictValuePayload = {
  encoding: 'json' | 'protobuf' | 'text' | 'number' | 'boolean';
  value: unknown;
};

export type ConflictPayload = {
  conflictId: string;
  conflictType: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  localValue: ConflictValuePayload;
  remoteValue: ConflictValuePayload;
  resolution:
    | 'unresolved'
    | 'local_wins'
    | 'remote_wins'
    | 'merged'
    | 'manual_override';
  resolutionText?: string;
  resolutionEventId?: string;
  createdAtMs: number;
  resolvedAtMs?: number;
};

export type PodReceiptStatus =
  | 'pending'
  | 'verified'
  | 'signature_mismatch'
  | 'replay_rejected'
  | 'expired'
  | 'rejected';

export type PodReceiptPayload = {
  receiptId: string;
  challengeId: string;
  deliveryId: string;
  status: PodReceiptStatus;
  senderUserId?: string;
  senderDeviceId: string;
  senderPublicKeyId: string;
  recipientUserId?: string;
  recipientDeviceId?: string;
  nonceHash: string;
  payloadHash: string;
  issuedAtMs: number;
  expiresAtMs: number;
  verifiedAtMs?: number;
  rejectionCode?: string;
  rejectionReason?: string;
  ledgerEventId?: string;
};

export type HandoffEventStatus =
  | 'pending'
  | 'confirmed'
  | 'ownership_transferred'
  | 'failed';

export type HandoffEventPayload = {
  handoffId: string;
  deliveryId: string;
  sourceVehicleId: string;
  sourceVehicleType: 'truck' | 'boat' | 'drone';
  targetVehicleId: string;
  targetVehicleType: 'truck' | 'boat' | 'drone';
  rendezvous: {
    latitude: number;
    longitude: number;
  };
  cargoIds: string[];
  receiptId?: string;
  status: HandoffEventStatus;
  occurredAtMs: number;
  ownershipTransferEventId?: string;
};
