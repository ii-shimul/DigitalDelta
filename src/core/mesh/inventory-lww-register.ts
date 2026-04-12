import { compareVectorClocks, mergeVectorClocks, type VectorClockMap } from '../crdt';

export type InventoryRegisterState = {
  quantity: number;
  vectorClock: VectorClockMap;
  occurredAtMs: number;
  eventId: string;
};

export type InventoryMergeResult = {
  quantity: number;
  vectorClock: VectorClockMap;
  occurredAtMs: number;
  chosenSource: 'local' | 'remote';
  concurrentConflict: boolean;
};

export function mergeInventoryLwwRegister(input: {
  local: InventoryRegisterState;
  remote: InventoryRegisterState;
}): InventoryMergeResult {
  const relation = compareVectorClocks(input.remote.vectorClock, input.local.vectorClock);

  if (relation === 'after') {
    return {
      quantity: input.remote.quantity,
      vectorClock: mergeVectorClocks(
        input.local.vectorClock,
        input.remote.vectorClock,
      ),
      occurredAtMs: input.remote.occurredAtMs,
      chosenSource: 'remote',
      concurrentConflict: false,
    };
  }

  if (relation === 'before') {
    return {
      quantity: input.local.quantity,
      vectorClock: mergeVectorClocks(
        input.local.vectorClock,
        input.remote.vectorClock,
      ),
      occurredAtMs: input.local.occurredAtMs,
      chosenSource: 'local',
      concurrentConflict: false,
    };
  }

  if (relation === 'equal') {
    const chooseRemote =
      input.remote.occurredAtMs > input.local.occurredAtMs ||
      (input.remote.occurredAtMs === input.local.occurredAtMs &&
        input.remote.eventId.localeCompare(input.local.eventId) > 0);

    return {
      quantity: chooseRemote ? input.remote.quantity : input.local.quantity,
      vectorClock: mergeVectorClocks(
        input.local.vectorClock,
        input.remote.vectorClock,
      ),
      occurredAtMs: chooseRemote
        ? input.remote.occurredAtMs
        : input.local.occurredAtMs,
      chosenSource: chooseRemote ? 'remote' : 'local',
      concurrentConflict: input.remote.quantity !== input.local.quantity,
    };
  }

  const chooseRemote =
    input.remote.occurredAtMs > input.local.occurredAtMs ||
    (input.remote.occurredAtMs === input.local.occurredAtMs &&
      input.remote.eventId.localeCompare(input.local.eventId) > 0);

  return {
    quantity: chooseRemote ? input.remote.quantity : input.local.quantity,
    vectorClock: mergeVectorClocks(input.local.vectorClock, input.remote.vectorClock),
    occurredAtMs: chooseRemote ? input.remote.occurredAtMs : input.local.occurredAtMs,
    chosenSource: chooseRemote ? 'remote' : 'local',
    concurrentConflict: true,
  };
}
