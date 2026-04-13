export type MeshThrottleSimulationResult = {
  durationMinutes: number;
  baseline: {
    broadcastIntervalMs: number;
    broadcastCount: number;
    batteryDrainPercent: number;
  };
  throttled: {
    broadcastIntervalMs: number;
    broadcastCount: number;
    batteryDrainPercent: number;
  };
  batterySavedPercent: number;
  batterySavedRatio: number;
  reductionApplied: {
    batteryLow: boolean;
    stationary: boolean;
    nearKnownNode: boolean;
    batteryReductionFactor: number;
    stationaryReductionFactor: number;
    proximityReductionFactor: number;
  };
  context: {
    batteryPercent: number;
    signalStrength: number;
    nearbyPeerCount: number;
    stationary: boolean;
    nearestNodeId?: string;
    knownNodeDistanceMeters: number;
  };
};

export function computeMeshThrottleSimulation(input: {
  durationMinutes?: number;
  baseBroadcastIntervalMs?: number;
  batteryPercent: number;
  signalStrength: number;
  nearbyPeerCount: number;
  stationary: boolean;
  knownNodeDistanceMeters: number;
  nearestNodeId?: string;
}): MeshThrottleSimulationResult {
  const durationMinutes = Math.max(1, Math.round(input.durationMinutes ?? 10));
  const durationMs = durationMinutes * 60_000;
  const baseBroadcastIntervalMs = Math.max(
    1_000,
    Math.round(input.baseBroadcastIntervalMs ?? 5_000),
  );
  const baselineBroadcastCount = Math.max(
    1,
    Math.floor(durationMs / baseBroadcastIntervalMs),
  );

  const batteryReductionFactor = input.batteryPercent < 30 ? 0.4 : 1;
  const stationaryReductionFactor = input.stationary ? 0.2 : 1;
  const proximityReductionFactor =
    input.knownNodeDistanceMeters <= 150
      ? 0.65
      : input.knownNodeDistanceMeters <= 500
        ? 0.85
        : 1;

  const throttledFactor =
    batteryReductionFactor * stationaryReductionFactor * proximityReductionFactor;
  const throttledBroadcastCount = Math.max(
    1,
    Math.floor(baselineBroadcastCount * throttledFactor),
  );
  const throttledBroadcastIntervalMs = Math.max(
    baseBroadcastIntervalMs,
    Math.round(durationMs / throttledBroadcastCount),
  );

  const batteryCostPerBroadcast = 0.03;
  const idleBatteryCostPerMinute = 0.02;

  const baselineDrain =
    baselineBroadcastCount * batteryCostPerBroadcast +
    durationMinutes * idleBatteryCostPerMinute;
  const throttledDrain =
    throttledBroadcastCount * batteryCostPerBroadcast +
    durationMinutes * idleBatteryCostPerMinute;
  const batterySavedPercent = Math.max(0, baselineDrain - throttledDrain);
  const batterySavedRatio =
    baselineDrain <= 0 ? 0 : batterySavedPercent / baselineDrain;

  return {
    durationMinutes,
    baseline: {
      broadcastIntervalMs: baseBroadcastIntervalMs,
      broadcastCount: baselineBroadcastCount,
      batteryDrainPercent: round2(baselineDrain),
    },
    throttled: {
      broadcastIntervalMs: throttledBroadcastIntervalMs,
      broadcastCount: throttledBroadcastCount,
      batteryDrainPercent: round2(throttledDrain),
    },
    batterySavedPercent: round2(batterySavedPercent),
    batterySavedRatio: round2(batterySavedRatio),
    reductionApplied: {
      batteryLow: input.batteryPercent < 30,
      stationary: input.stationary,
      nearKnownNode: input.knownNodeDistanceMeters <= 500,
      batteryReductionFactor,
      stationaryReductionFactor,
      proximityReductionFactor,
    },
    context: {
      batteryPercent: clampPercent(input.batteryPercent),
      signalStrength: clampPercent(input.signalStrength),
      nearbyPeerCount: Math.max(0, Math.round(input.nearbyPeerCount)),
      stationary: input.stationary,
      nearestNodeId: input.nearestNodeId,
      knownNodeDistanceMeters: Math.max(0, Math.round(input.knownNodeDistanceMeters)),
    },
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
