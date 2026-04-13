# Digital Delta

Offline-first resilient logistics and mesh triage engine for flood-response scenarios.

The app is built for high-disruption operations where internet, roads, and power can fail at the same time. Core workflows continue locally, then reconcile when peer connectivity is available.

## What This Prototype Demonstrates

- Persistent operational state UX: offline, syncing, conflict, verified.
- Offline OTP and device-bound identity with role-based access control.
- Conflict-tolerant local inventory updates with causal metadata.
- BLE-based delta sync transport with Protobuf payload encoding.
- Store-and-forward mesh messaging with TTL and end-to-end encryption.
- Dynamic multi-modal routing with edge failure injection and recomputation.
- Cryptographically verified proof-of-delivery handshake with replay protection.
- Autonomous triage decisions and drone handoff orchestration.

## Repository Layout

- App code: src
- Protocol schemas: proto
- Platform folders: android, ios
- Project requirements and judging context: requirement.md
- Demo walkthrough script: DEMO.md

## Architecture and Data Contracts

- The protocol contract root is proto/digital_delta.proto.
- Supporting schemas are in proto/auth.proto, proto/mesh.proto, proto/routing.proto, proto/triage.proto, proto/pod.proto, proto/fleet.proto, proto/sync.proto, proto/ledger.proto, proto/identity.proto, and proto/common.proto.
- BLE sync transport uses Protobuf messages for delta exchange.

## Prerequisites

- Node.js 22.11.0 or newer
- React Native Android/iOS toolchain (Android Studio and/or Xcode)
- Java and Android SDK configured for React Native
- CocoaPods for iOS builds

## Setup

1. Install dependencies:

```sh
pnpm install
```

If you prefer npm:

```sh
npm install
```

2. iOS only (first time or native dependency updates):

```sh
bundle install
bundle exec pod install
```

## Run the App

Start Metro:

```sh
pnpm start
```

Android:

```sh
pnpm android
```

iOS:

```sh
pnpm ios
```

## Quality Checks

Lint:

```sh
pnpm lint
```

Tests:

```sh
pnpm test
```

## Demo Execution

Use DEMO.md for a timed 10-minute walkthrough that covers:

- offline + sync behavior
- route recalculation under failure injection
- proof-of-delivery verification flow
- triage preemption behavior
- drone handoff flow

## Deliverables Mapping

For submission readiness:

- D1: This repository contains source code, setup instructions (this README), protocol schemas, and DEMO.md.
- D2: Demo flow is documented in DEMO.md.
- D3: Architecture references are provided via schema package layout in proto.
- D5: Pitch deck should be based on implemented features in this pull.

## Scope Note

Predictive ML model training and reporting is not part of the current demo scope. Routing risk handling can still consume high-risk edge status when present.
