import type { SQLBatchTuple } from '@op-engineering/op-sqlite';

import { DIGITAL_DELTA_SCHEMA_VERSION, SYNC_CAPABILITIES } from '../core';

import { getDatabase } from './database';
import type { DatabaseHandle } from './types';

export const PHASE0_DEMO_SCENARIO_ID = 'sylhet-flash-flood-delta';
export const PHASE0_DEMO_BASE_TIME_MS = Date.parse('2026-04-12T08:00:00Z');

const demoUsers = [
  {
    userId: 'USR-AMINA-001',
    displayName: 'Amina Rahman',
    primaryRole: 'SUPPLY_MANAGER',
    roles: ['SUPPLY_MANAGER', 'SYNC_ADMIN'],
    status: 'active',
    createdAtMs: PHASE0_DEMO_BASE_TIME_MS - 86_400_000,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    lastLoginAtMs: PHASE0_DEMO_BASE_TIME_MS,
  },
  {
    userId: 'USR-KABIR-002',
    displayName: 'Kabir Hasan',
    primaryRole: 'FIELD_VOLUNTEER',
    roles: ['FIELD_VOLUNTEER'],
    status: 'active',
    createdAtMs: PHASE0_DEMO_BASE_TIME_MS - 86_400_000,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    lastLoginAtMs: PHASE0_DEMO_BASE_TIME_MS - 3_600_000,
  },
  {
    userId: 'USR-NABILA-003',
    displayName: 'Nabila Ahmed',
    primaryRole: 'DRONE_OPERATOR',
    roles: ['DRONE_OPERATOR'],
    status: 'active',
    createdAtMs: PHASE0_DEMO_BASE_TIME_MS - 86_400_000,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    lastLoginAtMs: PHASE0_DEMO_BASE_TIME_MS - 7_200_000,
  },
] as const;

const demoDeviceIdentities = [
  {
    deviceId: 'DEV-ALPHA-01',
    userId: 'USR-AMINA-001',
    publicKeyPem:
      '-----BEGIN PUBLIC KEY-----\nMIIBPhase0AlphaKey\n-----END PUBLIC KEY-----',
    keyAlgorithm: 'ED25519',
    keyFingerprint: 'fp-alpha-01',
    roles: ['SUPPLY_MANAGER', 'SYNC_ADMIN'],
    provisionedAtMs: PHASE0_DEMO_BASE_TIME_MS - 43_200_000,
    lastRotatedAtMs: PHASE0_DEMO_BASE_TIME_MS - 10_800_000,
    metadata: {
      label: 'Operations Tablet',
      scenarioId: PHASE0_DEMO_SCENARIO_ID,
    },
  },
  {
    deviceId: 'DEV-BRAVO-02',
    userId: 'USR-KABIR-002',
    publicKeyPem:
      '-----BEGIN PUBLIC KEY-----\nMIIBPhase0BravoKey\n-----END PUBLIC KEY-----',
    keyAlgorithm: 'RSA_2048',
    keyFingerprint: 'fp-bravo-02',
    roles: ['FIELD_VOLUNTEER'],
    provisionedAtMs: PHASE0_DEMO_BASE_TIME_MS - 43_200_000,
    lastRotatedAtMs: null,
    metadata: {
      label: 'Field Volunteer Phone',
      scenarioId: PHASE0_DEMO_SCENARIO_ID,
    },
  },
  {
    deviceId: 'DEV-CHARLIE-03',
    userId: 'USR-NABILA-003',
    publicKeyPem:
      '-----BEGIN PUBLIC KEY-----\nMIIBPhase0CharlieKey\n-----END PUBLIC KEY-----',
    keyAlgorithm: 'ED25519',
    keyFingerprint: 'fp-charlie-03',
    roles: ['DRONE_OPERATOR'],
    provisionedAtMs: PHASE0_DEMO_BASE_TIME_MS - 43_200_000,
    lastRotatedAtMs: null,
    metadata: {
      label: 'Drone Control Unit',
      scenarioId: PHASE0_DEMO_SCENARIO_ID,
    },
  },
] as const;

const demoNodes = [
  {
    nodeId: 'N1',
    displayName: 'Sylhet Central Logistics Hub',
    nodeType: 'hub',
    latitude: 24.8949,
    longitude: 91.8687,
    isActive: 1,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { zone: 'sylhet', priority: 'high' },
  },
  {
    nodeId: 'N2',
    displayName: 'Sunamganj Camp Alpha',
    nodeType: 'camp',
    latitude: 25.0658,
    longitude: 91.395,
    isActive: 1,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { zone: 'sunamganj', population: 1800 },
  },
  {
    nodeId: 'N3',
    displayName: 'Biswanath River Dock',
    nodeType: 'dock',
    latitude: 24.8562,
    longitude: 91.7408,
    isActive: 1,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { zone: 'biswanath', relayCapable: true },
  },
  {
    nodeId: 'N4',
    displayName: 'Netrokona Field Hospital',
    nodeType: 'hospital',
    latitude: 24.8836,
    longitude: 90.7279,
    isActive: 1,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { zone: 'netrokona', emergencyTier: 'P0' },
  },
  {
    nodeId: 'N5',
    displayName: 'Kanaighat Camp Bravo',
    nodeType: 'camp',
    latitude: 25.015,
    longitude: 92.262,
    isActive: 1,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { zone: 'kanaighat', population: 950 },
  },
  {
    nodeId: 'N6',
    displayName: 'Companiganj Drone Base',
    nodeType: 'drone_base',
    latitude: 25.112,
    longitude: 91.924,
    isActive: 1,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { zone: 'companiganj', runway: true },
  },
  {
    nodeId: 'N7',
    displayName: 'Jaintiapur Isolated Camp',
    nodeType: 'camp',
    latitude: 25.151,
    longitude: 92.05,
    isActive: 1,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { zone: 'jaintiapur', droneRequired: true },
  },
] as const;

const demoEdges = [
  {
    edgeId: 'E1',
    sourceNodeId: 'N1',
    targetNodeId: 'N2',
    edgeType: 'road',
    status: 'open',
    travelTimeMinutes: 20,
    capacityUnits: 100,
    riskScore: 0.15,
    lastUpdateReason: 'manual_override',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: true },
  },
  {
    edgeId: 'E2',
    sourceNodeId: 'N1',
    targetNodeId: 'N3',
    edgeType: 'road',
    status: 'degraded',
    travelTimeMinutes: 90,
    capacityUnits: 60,
    riskScore: 0.41,
    lastUpdateReason: 'predicted_decay',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: true },
  },
  {
    edgeId: 'E3',
    sourceNodeId: 'N2',
    targetNodeId: 'N4',
    edgeType: 'road',
    status: 'open',
    travelTimeMinutes: 45,
    capacityUnits: 45,
    riskScore: 0.28,
    lastUpdateReason: 'manual_override',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: true },
  },
  {
    edgeId: 'E4',
    sourceNodeId: 'N1',
    targetNodeId: 'N5',
    edgeType: 'road',
    status: 'open',
    travelTimeMinutes: 60,
    capacityUnits: 50,
    riskScore: 0.3,
    lastUpdateReason: 'manual_override',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: true },
  },
  {
    edgeId: 'E5',
    sourceNodeId: 'N1',
    targetNodeId: 'N6',
    edgeType: 'road',
    status: 'high_risk',
    travelTimeMinutes: 120,
    capacityUnits: 40,
    riskScore: 0.78,
    lastUpdateReason: 'predicted_decay',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: true },
  },
  {
    edgeId: 'E6',
    sourceNodeId: 'N1',
    targetNodeId: 'N3',
    edgeType: 'waterway',
    status: 'open',
    travelTimeMinutes: 150,
    capacityUnits: 120,
    riskScore: 0.1,
    lastUpdateReason: 'manual_override',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: true },
  },
  {
    edgeId: 'E7',
    sourceNodeId: 'N3',
    targetNodeId: 'N4',
    edgeType: 'waterway',
    status: 'open',
    travelTimeMinutes: 50,
    capacityUnits: 80,
    riskScore: 0.2,
    lastUpdateReason: 'manual_override',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: true },
  },
  {
    edgeId: 'E8',
    sourceNodeId: 'N6',
    targetNodeId: 'N7',
    edgeType: 'airway',
    status: 'open',
    travelTimeMinutes: 18,
    capacityUnits: 12,
    riskScore: 0.12,
    lastUpdateReason: 'manual_override',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: false },
  },
  {
    edgeId: 'E9',
    sourceNodeId: 'N3',
    targetNodeId: 'N7',
    edgeType: 'airway',
    status: 'open',
    travelTimeMinutes: 22,
    capacityUnits: 10,
    riskScore: 0.18,
    lastUpdateReason: 'handoff_required',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { sampleEdge: false },
  },
] as const;

const demoVehicles = [
  {
    vehicleId: 'VEH-TRUCK-01',
    displayName: 'Truck Atlas',
    vehicleType: 'truck',
    capacityUnits: 220,
    payloadLimitGrams: 750000,
    batteryPercent: null,
    currentNodeId: 'N1',
    latitude: 24.8949,
    longitude: 91.8687,
    status: 'en_route',
    assignedDeliveryId: 'DLV-001',
    lastSeenAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { operatorUserId: 'USR-KABIR-002' },
  },
  {
    vehicleId: 'VEH-BOAT-01',
    displayName: 'Boat Meghna',
    vehicleType: 'speedboat',
    capacityUnits: 300,
    payloadLimitGrams: 1200000,
    batteryPercent: 64,
    currentNodeId: 'N3',
    latitude: 24.8562,
    longitude: 91.7408,
    status: 'awaiting_handoff',
    assignedDeliveryId: 'DLV-004',
    lastSeenAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { operatorUserId: 'USR-KABIR-002' },
  },
  {
    vehicleId: 'VEH-DRONE-01',
    displayName: 'Drone Padma',
    vehicleType: 'drone',
    capacityUnits: 12,
    payloadLimitGrams: 15000,
    batteryPercent: 78,
    currentNodeId: 'N6',
    latitude: 25.112,
    longitude: 91.924,
    status: 'ready',
    assignedDeliveryId: 'DLV-003',
    lastSeenAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { operatorUserId: 'USR-NABILA-003' },
  },
] as const;

const demoInventory = [
  {
    inventoryItemId: 'INV-ANTI-01',
    sku: 'MED-ANTI-01',
    itemName: 'Antivenom Vials',
    category: 'medical',
    quantity: 24,
    unit: 'vials',
    storageNodeId: 'N1',
    status: 'available',
    vectorClockJson: '{"DEV-ALPHA-01":2}',
    lastMutationEventId: 'EVT-INV-001',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { coldChain: true },
  },
  {
    inventoryItemId: 'INV-ORS-01',
    sku: 'MED-ORS-01',
    itemName: 'Oral Saline Packs',
    category: 'medical',
    quantity: 600,
    unit: 'packs',
    storageNodeId: 'N1',
    status: 'available',
    vectorClockJson: '{"DEV-ALPHA-01":3}',
    lastMutationEventId: 'EVT-INV-002',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { humiditySensitive: false },
  },
  {
    inventoryItemId: 'INV-FOOD-01',
    sku: 'FOOD-DRY-01',
    itemName: 'Dry Food Packs',
    category: 'food',
    quantity: 400,
    unit: 'packs',
    storageNodeId: 'N1',
    status: 'available',
    vectorClockJson: '{"DEV-ALPHA-01":1}',
    lastMutationEventId: 'EVT-INV-003',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { stackable: true },
  },
  {
    inventoryItemId: 'INV-HYGIENE-01',
    sku: 'KIT-HYGIENE-01',
    itemName: 'Hygiene Kits',
    category: 'relief',
    quantity: 120,
    unit: 'kits',
    storageNodeId: 'N3',
    status: 'available',
    vectorClockJson: '{"DEV-BRAVO-02":1}',
    lastMutationEventId: 'EVT-INV-004',
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { dropAllowed: true },
  },
] as const;

const demoDeliveries = [
  {
    deliveryId: 'DLV-001',
    originNodeId: 'N1',
    destinationNodeId: 'N4',
    assignedVehicleId: 'VEH-TRUCK-01',
    assignedVehicleType: 'truck',
    priorityTier: 'P0',
    status: 'in_transit',
    etaMinutes: 65,
    currentRouteId: 'RTE-001',
    requiresHandoff: 0,
    createdAtMs: PHASE0_DEMO_BASE_TIME_MS - 3_600_000,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { scenario: 'medical-corridor' },
  },
  {
    deliveryId: 'DLV-003',
    originNodeId: 'N6',
    destinationNodeId: 'N7',
    assignedVehicleId: 'VEH-DRONE-01',
    assignedVehicleType: 'drone',
    priorityTier: 'P1',
    status: 'ready_for_dispatch',
    etaMinutes: 18,
    currentRouteId: 'RTE-003',
    requiresHandoff: 0,
    createdAtMs: PHASE0_DEMO_BASE_TIME_MS - 2_700_000,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { scenario: 'drone-last-mile' },
  },
  {
    deliveryId: 'DLV-004',
    originNodeId: 'N1',
    destinationNodeId: 'N7',
    assignedVehicleId: 'VEH-BOAT-01',
    assignedVehicleType: 'speedboat',
    priorityTier: 'P1',
    status: 'pending_handoff',
    etaMinutes: 150,
    currentRouteId: 'RTE-004',
    requiresHandoff: 1,
    createdAtMs: PHASE0_DEMO_BASE_TIME_MS - 1_800_000,
    updatedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { scenario: 'boat-to-drone' },
  },
] as const;

const demoCargoItems = [
  {
    cargoId: 'CRG-001',
    deliveryId: 'DLV-001',
    inventoryItemId: 'INV-ANTI-01',
    itemName: 'Antivenom Vials',
    category: 'medical',
    quantity: 4,
    unit: 'vials',
    priorityTier: 'P0',
    slaDeadlineMs: PHASE0_DEMO_BASE_TIME_MS + 7_200_000,
    status: 'loaded',
    weightGrams: 1200,
    dropAllowed: 0,
    metadata: { coldChain: true },
  },
  {
    cargoId: 'CRG-002',
    deliveryId: 'DLV-001',
    inventoryItemId: 'INV-ORS-01',
    itemName: 'Oral Saline Packs',
    category: 'medical',
    quantity: 80,
    unit: 'packs',
    priorityTier: 'P1',
    slaDeadlineMs: PHASE0_DEMO_BASE_TIME_MS + 21_600_000,
    status: 'loaded',
    weightGrams: 6400,
    dropAllowed: 0,
    metadata: { fieldHospital: 'N4' },
  },
  {
    cargoId: 'CRG-003',
    deliveryId: 'DLV-003',
    inventoryItemId: 'INV-ORS-01',
    itemName: 'Emergency Saline Packs',
    category: 'medical',
    quantity: 20,
    unit: 'packs',
    priorityTier: 'P1',
    slaDeadlineMs: PHASE0_DEMO_BASE_TIME_MS + 21_600_000,
    status: 'staged',
    weightGrams: 1600,
    dropAllowed: 0,
    metadata: { destination: 'N7' },
  },
  {
    cargoId: 'CRG-004',
    deliveryId: 'DLV-004',
    inventoryItemId: 'INV-FOOD-01',
    itemName: 'Dry Food Packs',
    category: 'food',
    quantity: 60,
    unit: 'packs',
    priorityTier: 'P2',
    slaDeadlineMs: PHASE0_DEMO_BASE_TIME_MS + 86_400_000,
    status: 'loaded',
    weightGrams: 24000,
    dropAllowed: 1,
    metadata: { destination: 'N7' },
  },
  {
    cargoId: 'CRG-005',
    deliveryId: 'DLV-004',
    inventoryItemId: 'INV-HYGIENE-01',
    itemName: 'Hygiene Kits',
    category: 'relief',
    quantity: 30,
    unit: 'kits',
    priorityTier: 'P3',
    slaDeadlineMs: PHASE0_DEMO_BASE_TIME_MS + 259_200_000,
    status: 'loaded',
    weightGrams: 18000,
    dropAllowed: 1,
    metadata: { destination: 'N7' },
  },
] as const;

const demoRoutePlans = [
  {
    routeId: 'RTE-001',
    deliveryId: 'DLV-001',
    vehicleId: 'VEH-TRUCK-01',
    vehicleType: 'truck',
    totalEtaMinutes: 65,
    totalRiskScore: 0.43,
    blockedEdgeIds: [],
    handoffNodeIds: [],
    legs: [
      {
        legId: 'LEG-001-A',
        edgeId: 'E1',
        fromNodeId: 'N1',
        toNodeId: 'N2',
        edgeType: 'road',
        vehicleType: 'truck',
        etaMinutes: 20,
        riskScore: 0.15,
        status: 'active',
      },
      {
        legId: 'LEG-001-B',
        edgeId: 'E3',
        fromNodeId: 'N2',
        toNodeId: 'N4',
        edgeType: 'road',
        vehicleType: 'truck',
        etaMinutes: 45,
        riskScore: 0.28,
        status: 'planned',
      },
    ],
    updateReason: 'manual_override',
    predictedFailureProbability: 0.18,
    requiresHandoff: 0,
    computedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { scenario: 'medical-corridor' },
  },
  {
    routeId: 'RTE-003',
    deliveryId: 'DLV-003',
    vehicleId: 'VEH-DRONE-01',
    vehicleType: 'drone',
    totalEtaMinutes: 18,
    totalRiskScore: 0.12,
    blockedEdgeIds: [],
    handoffNodeIds: [],
    legs: [
      {
        legId: 'LEG-003-A',
        edgeId: 'E8',
        fromNodeId: 'N6',
        toNodeId: 'N7',
        edgeType: 'airway',
        vehicleType: 'drone',
        etaMinutes: 18,
        riskScore: 0.12,
        status: 'planned',
      },
    ],
    updateReason: 'manual_override',
    predictedFailureProbability: 0.12,
    requiresHandoff: 0,
    computedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { scenario: 'drone-last-mile' },
  },
  {
    routeId: 'RTE-004',
    deliveryId: 'DLV-004',
    vehicleId: 'VEH-BOAT-01',
    vehicleType: 'speedboat',
    totalEtaMinutes: 150,
    totalRiskScore: 0.1,
    blockedEdgeIds: [],
    handoffNodeIds: ['N3'],
    legs: [
      {
        legId: 'LEG-004-A',
        edgeId: 'E6',
        fromNodeId: 'N1',
        toNodeId: 'N3',
        edgeType: 'waterway',
        vehicleType: 'speedboat',
        etaMinutes: 150,
        riskScore: 0.1,
        status: 'active',
      },
    ],
    updateReason: 'handoff_required',
    predictedFailureProbability: 0.34,
    requiresHandoff: 1,
    computedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { scenario: 'boat-to-drone' },
  },
] as const;

const demoPredictions = [
  {
    predictionId: 'PRED-001',
    edgeId: 'E5',
    probability: 0.81,
    threshold: 0.7,
    features: {
      cumulativeRainfallMm: 182,
      rainfallRateMmPerHour: 36,
      elevationMeters: 14,
      soilSaturationProxy: 0.87,
    },
    predictedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    modelVersion: 'phase0-logreg-v1',
    metadata: { reason: 'monsoon-spike' },
  },
  {
    predictionId: 'PRED-002',
    edgeId: 'E2',
    probability: 0.68,
    threshold: 0.7,
    features: {
      cumulativeRainfallMm: 141,
      rainfallRateMmPerHour: 22,
      elevationMeters: 18,
      soilSaturationProxy: 0.74,
    },
    predictedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    modelVersion: 'phase0-logreg-v1',
    metadata: { reason: 'approaching-threshold' },
  },
] as const;

const demoPodReceipts = [
  {
    receiptId: 'POD-001',
    deliveryId: 'DLV-001',
    challengeId: 'CHAL-001',
    status: 'verified',
    senderDeviceId: 'DEV-ALPHA-01',
    senderUserId: 'USR-AMINA-001',
    senderPublicKeyId: 'fp-alpha-01',
    recipientUserId: 'USR-KABIR-002',
    recipientDeviceId: 'DEV-BRAVO-02',
    nonce: 'nonce-pod-001',
    payloadHash: 'payload-hash-001',
    issuedAtMs: PHASE0_DEMO_BASE_TIME_MS - 900_000,
    expiresAtMs: PHASE0_DEMO_BASE_TIME_MS - 600_000,
    verifiedAtMs: PHASE0_DEMO_BASE_TIME_MS - 650_000,
    rejectionCode: null,
    rejectionReason: null,
    metadata: { note: 'hospital handoff verified offline' },
  },
] as const;

const demoUsedNonces = [
  {
    nonceHash: 'nonce-pod-001',
    deliveryId: 'DLV-001',
    receiptId: 'POD-001',
    consumedAtMs: PHASE0_DEMO_BASE_TIME_MS - 650_000,
    metadata: { source: 'seed' },
  },
] as const;

const demoHandoffEvents = [
  {
    handoffId: 'HND-001',
    deliveryId: 'DLV-004',
    sourceVehicleId: 'VEH-BOAT-01',
    sourceVehicleType: 'speedboat',
    targetVehicleId: 'VEH-DRONE-01',
    targetVehicleType: 'drone',
    rendezvousLatitude: 24.8562,
    rendezvousLongitude: 91.7408,
    cargoIds: ['CRG-004', 'CRG-005'],
    receiptId: null,
    status: 'confirmed',
    occurredAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { nodeId: 'N3' },
  },
] as const;

const demoTriageDecisions = [
  {
    decisionId: 'TRI-001',
    deliveryId: 'DLV-004',
    highestRemainingPriority: 'P1',
    preempted: 1,
    droppedCargoIds: ['CRG-005'],
    safeWaypointNodeId: 'N3',
    rationale:
      'Dropped low-priority hygiene kits at Biswanath River Dock to preserve drone payload for higher-priority medical supplies.',
    decidedAtMs: PHASE0_DEMO_BASE_TIME_MS,
    metadata: { triggeredBy: 'sla_preemption' },
  },
] as const;

const demoConflicts = [
  {
    conflictId: 'CNF-001',
    conflictType: 'concurrent_field_update',
    entityType: 'supply_item',
    entityId: 'INV-ORS-01',
    fieldName: 'quantity',
    localValueBlob: null,
    remoteValueBlob: null,
    resolutionText: 'Accepted remote quantity after merge at the last sync.',
    resolutionEventId: 'EVT-CNF-001',
    createdAtMs: PHASE0_DEMO_BASE_TIME_MS - 1_200_000,
    resolvedAtMs: PHASE0_DEMO_BASE_TIME_MS - 1_080_000,
    metadata: { localQuantity: 600, remoteQuantity: 580 },
  },
] as const;

const demoSyncPeers = [
  {
    peerDeviceId: 'DEV-BRAVO-02',
    transport: 'bluetooth_le',
    lastEnvelopeId: 'ENV-001',
    lastEventId: 'EVT-CNF-001',
    lastVectorClockJson: '{"DEV-ALPHA-01":4,"DEV-BRAVO-02":3}',
    supportedCapabilitiesJson: json([...SYNC_CAPABILITIES]),
    lastSyncedAtMs: PHASE0_DEMO_BASE_TIME_MS - 300_000,
    lastSeenAtMs: PHASE0_DEMO_BASE_TIME_MS - 180_000,
    schemaVersion: DIGITAL_DELTA_SCHEMA_VERSION,
    metadata: { trustLevel: 'paired' },
  },
] as const;

export const PHASE0_DEMO_SCENARIO = {
  id: PHASE0_DEMO_SCENARIO_ID,
  baseTimeMs: PHASE0_DEMO_BASE_TIME_MS,
  users: demoUsers,
  deviceIdentities: demoDeviceIdentities,
  nodes: demoNodes,
  edges: demoEdges,
  vehicles: demoVehicles,
  inventory: demoInventory,
  deliveries: demoDeliveries,
  cargoItems: demoCargoItems,
  routePlans: demoRoutePlans,
  predictions: demoPredictions,
  podReceipts: demoPodReceipts,
  usedNonces: demoUsedNonces,
  handoffEvents: demoHandoffEvents,
  triageDecisions: demoTriageDecisions,
  conflicts: demoConflicts,
  syncPeers: demoSyncPeers,
} as const;

export async function seedPhase0DemoData(options: { reset?: boolean } = {}) {
  const db = await getDatabase();

  if (options.reset) {
    await db.executeBatch(buildResetStatements());
  }

  await db.executeBatch(buildSeedStatements());
}

export function getPhase0DemoScenario() {
  return PHASE0_DEMO_SCENARIO;
}

function buildResetStatements(): SQLBatchTuple[] {
  return [
    ['DELETE FROM sync_outbox'],
    ['DELETE FROM sync_peers'],
    ['DELETE FROM ledger_events'],
    ['DELETE FROM conflicts'],
    ['DELETE FROM triage_decisions'],
    ['DELETE FROM handoff_events'],
    ['DELETE FROM used_nonces'],
    ['DELETE FROM pod_receipts'],
    ['DELETE FROM route_predictions'],
    ['DELETE FROM route_plans'],
    ['DELETE FROM cargo_items'],
    ['DELETE FROM deliveries'],
    ['DELETE FROM supply_inventory'],
    ['DELETE FROM vehicles'],
    ['DELETE FROM route_edges'],
    ['DELETE FROM network_nodes'],
    ['DELETE FROM auth_audit_log'],
    ['DELETE FROM device_identity'],
    ['DELETE FROM users'],
  ];
}

function buildSeedStatements(): SQLBatchTuple[] {
  const statements: SQLBatchTuple[] = [];

  for (const user of demoUsers) {
    statements.push([
      `
        INSERT OR REPLACE INTO users (
          user_id,
          display_name,
          primary_role,
          roles_json,
          status,
          created_at_ms,
          updated_at_ms,
          last_login_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        user.userId,
        user.displayName,
        user.primaryRole,
        json(user.roles),
        user.status,
        user.createdAtMs,
        user.updatedAtMs,
        user.lastLoginAtMs,
      ],
    ]);
  }

  for (const device of demoDeviceIdentities) {
    statements.push([
      `
        INSERT OR REPLACE INTO device_identity (
          device_id,
          user_id,
          public_key_pem,
          key_algorithm,
          key_fingerprint,
          roles_json,
          provisioned_at_ms,
          last_rotated_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        device.deviceId,
        device.userId,
        device.publicKeyPem,
        device.keyAlgorithm,
        device.keyFingerprint,
        json(device.roles),
        device.provisionedAtMs,
        device.lastRotatedAtMs,
        json(device.metadata),
      ],
    ]);
  }

  for (const node of demoNodes) {
    statements.push([
      `
        INSERT OR REPLACE INTO network_nodes (
          node_id,
          display_name,
          node_type,
          latitude,
          longitude,
          is_active,
          metadata_json,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        node.nodeId,
        node.displayName,
        node.nodeType,
        node.latitude,
        node.longitude,
        node.isActive,
        json(node.metadata),
        node.updatedAtMs,
      ],
    ]);
  }

  for (const edge of demoEdges) {
    statements.push([
      `
        INSERT OR REPLACE INTO route_edges (
          edge_id,
          source_node_id,
          target_node_id,
          edge_type,
          status,
          travel_time_minutes,
          capacity_units,
          risk_score,
          last_update_reason,
          updated_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        edge.edgeId,
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.edgeType,
        edge.status,
        edge.travelTimeMinutes,
        edge.capacityUnits,
        edge.riskScore,
        edge.lastUpdateReason,
        edge.updatedAtMs,
        json(edge.metadata),
      ],
    ]);
  }

  for (const vehicle of demoVehicles) {
    statements.push([
      `
        INSERT OR REPLACE INTO vehicles (
          vehicle_id,
          display_name,
          vehicle_type,
          capacity_units,
          payload_limit_grams,
          battery_percent,
          current_node_id,
          latitude,
          longitude,
          status,
          assigned_delivery_id,
          last_seen_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        vehicle.vehicleId,
        vehicle.displayName,
        vehicle.vehicleType,
        vehicle.capacityUnits,
        vehicle.payloadLimitGrams,
        vehicle.batteryPercent,
        vehicle.currentNodeId,
        vehicle.latitude,
        vehicle.longitude,
        vehicle.status,
        vehicle.assignedDeliveryId,
        vehicle.lastSeenAtMs,
        json(vehicle.metadata),
      ],
    ]);
  }

  for (const item of demoInventory) {
    statements.push([
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
        item.inventoryItemId,
        item.sku,
        item.itemName,
        item.category,
        item.quantity,
        item.unit,
        item.storageNodeId,
        item.status,
        item.vectorClockJson,
        item.lastMutationEventId,
        item.updatedAtMs,
        json(item.metadata),
      ],
    ]);
  }

  for (const delivery of demoDeliveries) {
    statements.push([
      `
        INSERT OR REPLACE INTO deliveries (
          delivery_id,
          origin_node_id,
          destination_node_id,
          assigned_vehicle_id,
          assigned_vehicle_type,
          priority_tier,
          status,
          eta_minutes,
          current_route_id,
          requires_handoff,
          created_at_ms,
          updated_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        delivery.deliveryId,
        delivery.originNodeId,
        delivery.destinationNodeId,
        delivery.assignedVehicleId,
        delivery.assignedVehicleType,
        delivery.priorityTier,
        delivery.status,
        delivery.etaMinutes,
        delivery.currentRouteId,
        delivery.requiresHandoff,
        delivery.createdAtMs,
        delivery.updatedAtMs,
        json(delivery.metadata),
      ],
    ]);
  }

  for (const cargo of demoCargoItems) {
    statements.push([
      `
        INSERT OR REPLACE INTO cargo_items (
          cargo_id,
          delivery_id,
          inventory_item_id,
          item_name,
          category,
          quantity,
          unit,
          priority_tier,
          sla_deadline_ms,
          status,
          weight_grams,
          drop_allowed,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cargo.cargoId,
        cargo.deliveryId,
        cargo.inventoryItemId,
        cargo.itemName,
        cargo.category,
        cargo.quantity,
        cargo.unit,
        cargo.priorityTier,
        cargo.slaDeadlineMs,
        cargo.status,
        cargo.weightGrams,
        cargo.dropAllowed,
        json(cargo.metadata),
      ],
    ]);
  }

  for (const route of demoRoutePlans) {
    statements.push([
      `
        INSERT OR REPLACE INTO route_plans (
          route_id,
          delivery_id,
          vehicle_id,
          vehicle_type,
          total_eta_minutes,
          total_risk_score,
          blocked_edge_ids_json,
          handoff_node_ids_json,
          legs_json,
          update_reason,
          predicted_failure_probability,
          requires_handoff,
          computed_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        route.routeId,
        route.deliveryId,
        route.vehicleId,
        route.vehicleType,
        route.totalEtaMinutes,
        route.totalRiskScore,
        json(route.blockedEdgeIds),
        json(route.handoffNodeIds),
        json(route.legs),
        route.updateReason,
        route.predictedFailureProbability,
        route.requiresHandoff,
        route.computedAtMs,
        json(route.metadata),
      ],
    ]);
  }

  for (const prediction of demoPredictions) {
    statements.push([
      `
        INSERT OR REPLACE INTO route_predictions (
          prediction_id,
          edge_id,
          probability,
          threshold,
          features_json,
          predicted_at_ms,
          model_version,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        prediction.predictionId,
        prediction.edgeId,
        prediction.probability,
        prediction.threshold,
        json(prediction.features),
        prediction.predictedAtMs,
        prediction.modelVersion,
        json(prediction.metadata),
      ],
    ]);
  }

  for (const receipt of demoPodReceipts) {
    statements.push([
      `
        INSERT OR REPLACE INTO pod_receipts (
          receipt_id,
          delivery_id,
          challenge_id,
          status,
          sender_device_id,
          sender_user_id,
          sender_public_key_id,
          recipient_user_id,
          recipient_device_id,
          nonce,
          payload_hash,
          issued_at_ms,
          expires_at_ms,
          verified_at_ms,
          rejection_code,
          rejection_reason,
          receipt_blob,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        receipt.receiptId,
        receipt.deliveryId,
        receipt.challengeId,
        receipt.status,
        receipt.senderDeviceId,
        receipt.senderUserId,
        receipt.senderPublicKeyId,
        receipt.recipientUserId,
        receipt.recipientDeviceId,
        receipt.nonce,
        receipt.payloadHash,
        receipt.issuedAtMs,
        receipt.expiresAtMs,
        receipt.verifiedAtMs,
        receipt.rejectionCode,
        receipt.rejectionReason,
        null,
        json(receipt.metadata),
      ],
    ]);
  }

  for (const nonce of demoUsedNonces) {
    statements.push([
      `
        INSERT OR REPLACE INTO used_nonces (
          nonce_hash,
          delivery_id,
          receipt_id,
          consumed_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?)
      `,
      [
        nonce.nonceHash,
        nonce.deliveryId,
        nonce.receiptId,
        nonce.consumedAtMs,
        json(nonce.metadata),
      ],
    ]);
  }

  for (const handoff of demoHandoffEvents) {
    statements.push([
      `
        INSERT OR REPLACE INTO handoff_events (
          handoff_id,
          delivery_id,
          source_vehicle_id,
          source_vehicle_type,
          target_vehicle_id,
          target_vehicle_type,
          rendezvous_latitude,
          rendezvous_longitude,
          cargo_ids_json,
          receipt_id,
          status,
          occurred_at_ms,
          event_blob,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        handoff.handoffId,
        handoff.deliveryId,
        handoff.sourceVehicleId,
        handoff.sourceVehicleType,
        handoff.targetVehicleId,
        handoff.targetVehicleType,
        handoff.rendezvousLatitude,
        handoff.rendezvousLongitude,
        json(handoff.cargoIds),
        handoff.receiptId,
        handoff.status,
        handoff.occurredAtMs,
        null,
        json(handoff.metadata),
      ],
    ]);
  }

  for (const triage of demoTriageDecisions) {
    statements.push([
      `
        INSERT OR REPLACE INTO triage_decisions (
          decision_id,
          delivery_id,
          highest_remaining_priority,
          preempted,
          dropped_cargo_ids_json,
          safe_waypoint_node_id,
          rationale,
          decided_at_ms,
          decision_blob,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        triage.decisionId,
        triage.deliveryId,
        triage.highestRemainingPriority,
        triage.preempted,
        json(triage.droppedCargoIds),
        triage.safeWaypointNodeId,
        triage.rationale,
        triage.decidedAtMs,
        null,
        json(triage.metadata),
      ],
    ]);
  }

  for (const conflict of demoConflicts) {
    statements.push([
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
        conflict.conflictId,
        conflict.conflictType,
        conflict.entityType,
        conflict.entityId,
        conflict.fieldName,
        conflict.localValueBlob,
        conflict.remoteValueBlob,
        conflict.resolutionText,
        conflict.resolutionEventId,
        conflict.createdAtMs,
        conflict.resolvedAtMs,
        json(conflict.metadata),
      ],
    ]);
  }

  for (const peer of demoSyncPeers) {
    statements.push([
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
        peer.peerDeviceId,
        peer.transport,
        peer.lastEnvelopeId,
        peer.lastEventId,
        peer.lastVectorClockJson,
        peer.supportedCapabilitiesJson,
        peer.lastSyncedAtMs,
        peer.lastSeenAtMs,
        peer.schemaVersion,
        json(peer.metadata),
      ],
    ]);
  }

  return statements;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
