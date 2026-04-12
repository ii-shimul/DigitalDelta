# Digital Delta - Phase 0 Task 5

## Seeded Demo Scenario Freeze (v1)

Owner: UI and device interaction teammate
Date: 2026-04-12
Status: Ready for teammate sign-off

## 1) Goal

Complete Phase 0 Task 5 from instructions:

1. Lock the seeded demo scenario.
2. Ensure screens are built against stable data.

Canonical implementation source:

1. src/api/seeded-demo-scenario.ts

## 2) Requirement alignment

This seeded scenario directly supports requirement and instruction priorities:

1. Offline-first demo behavior (C4) with offline baseline state.
2. Visual state clarity for Offline, Syncing, Conflict Detected, Verified (A5).
3. Route recompute and risk overlays for route dashboard expectations (M4, M7).
4. PoD verification outcomes including replay rejection and expiry (M5).
5. Mesh sync progress and conflict visibility for CRDT sync flow (M2, M3).
6. Boat-to-drone handoff with ownership transfer evidence (M8).

## 3) Locked scenario identity

1. scenarioId: sylhet-flash-flood-v1
2. version: 1.0.0
3. region: Sylhet Division
4. seededAtMs: 2026-04-12T08:00:00.000Z
5. offlineCapable: true

## 4) Locked screen data fixtures

All required screens have stable fixtures:

1. Login fixture
2. Dashboard fixtures by variant
3. RouteDetails fixture
4. DeliveryDetails fixture
5. SyncStatus fixtures by variant
6. HandoffFlow fixture

Variants locked for dashboard and sync status:

1. offline-baseline
2. syncing-live
3. conflict-detected
4. verified-final

## 5) Locked payload fixtures

The seeded scenario includes fixed payloads for the already agreed Task 3 contracts:

1. RouteResultPayload fixture
2. ConflictPayload fixture
3. PodReceiptPayload fixture
4. HandoffEventPayload fixture

## 6) Locked PoD outcome matrix

The scenario includes judge-facing PoD result fixtures:

1. verification-success
2. signature-mismatch
3. replay-rejected
4. challenge-expired

## 7) Locked demo script order

The script is frozen as a stable walkthrough sequence:

1. Offline login
2. Dashboard offline state
3. Route visualization and recompute context
4. PoD verification outcome
5. Mesh sync progress
6. Conflict detection and resolution
7. Handoff finalization

## 8) How UI should consume this seed

1. Screens consume typed contracts from src/api only.
2. UI components should not query SQLite directly.
3. During shell and UI implementation, use this seed for deterministic rendering and QA rehearsal.
4. Live service wiring can replace seed later without changing screen contract shapes.

## 9) Freeze checklist

1. Both teammates accept scenario id and version.
2. Both teammates accept all six screen fixtures.
3. Both teammates accept four scenario variants.
4. Both teammates accept payload fixtures and PoD outcome matrix.
5. Both teammates accept demo script order.
6. Any scenario changes after this point are additive and version-bumped.
