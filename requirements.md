Here is the text from the project document, formatted in simple markdown without any tables:
HackFusion 2026-IEEE CS LU SB Chapter
Track: Advanced Systems & Disaster Resilience 
HACKFUSION 2026
IEEE Computer Society - Leading University SB Chapter
OFFICIAL PROBLEM STATEMENT: Engineering & Disaster Resilience 
**Challenge Details**
 * **Track:** Advanced Systems
 * **Duration:** 24 Hours
 * **Team Size:** Max 3 Members
 * **Total Marks:** 100 Points
 * **Level:** University 
Challenge Title: "Digital Delta"
Resilient Logistics & Mesh Triage Engine for Disaster Response 
### 0.1 Background & Scenario
The northern and northeastern districts of Bangladesh experience catastrophic flash floods every monsoon season. In July 2025, the Sylhet, Sunamganj, and Netrokona regions recorded over 5.2 million displaced persons within 72 hours. Traditional cellular infrastructure, power grids, and road networks collapsed simultaneously - rendering commercial logistics platforms entirely non-functional. 
Your team is challenged to architect and prototype "Digital Delta", an offline-first, decentralized logistics coordination system designed to operate when the internet is unavailable for up to 90% of the operation timeline. This is not a mockup; your prototype must demonstrate real, working distributed logic under simulated disaster conditions. Mission: Coordinate the delivery of critical relief supplies across a decentralized network of volunteers, boats, drones, and field hospitals with zero dependency on central servers or commercial internet. 
### Section 1 - Marks Distribution Overview
The total score is 100 points distributed across two independent evaluation tracks: 
 * **Track A - UI/UX & Frontend Design (Aesthetic Layer)**
   * **Max Points:** 30
   * **Independence Note:** Fully independent. Not scoring here does NOT affect Track B.
 * **Track B - System Engineering & Core Functionality (8 Modules)**
   * **Max Points:** 70
   * **Independence Note:** Scored regardless of Track A performance.
 * **TOTAL:** 100 Points 
Important: Track A (UI/UX, 30 pts) and Track B (Engineering, 70 pts) are evaluated completely independently. A team that builds excellent engineering but poor UI loses at most 30 points. A team with a beautiful UI but no working backend scores at most 30 points. 
### Track A - UI/UX & Frontend Design [30 Points]
This track evaluates the visual interface, user experience, and accessibility of your application independently of backend logic. A team may implement functional mocks or stubs here. Judges evaluate this as a standalone product design challenge. 
 * **A1-Visual Design System & Branding (6 Points)**
   * **Evaluation Criteria:** Consistent design language: color palette, typography hierarchy, component library. Evaluated via Figma, CSS variables, or equivalent. Must feel production-grade, not a template. 
 * **A2-Responsive & Adaptive Layouts (6 Points)**
   * **Evaluation Criteria:** Fully responsive across mobile (360px), tablet (768px), and desktop (1440px). No layout breakage. Offline-mode fallback UI must degrade gracefully. 
 * **A3-Dashboard & Data Visualization (8 Points)**
   * **Evaluation Criteria:** Real-time or simulated route map, supply inventory heatmap, and node status panel. Data must be visually scannable within 3 seconds during a demo scenario. 
 * **A4-Accessibility & UX Excellence (5 Points)**
   * **Evaluation Criteria:** WCAG 2.1 AA compliance for critical paths. Keyboard navigability, sufficient color contrast (4.5:1), and screen-reader labels on interactive elements. 
 * **A5-Offline Indicator & Sync Feedback UX (5 Points)**
   * **Evaluation Criteria:** Clear visual state management for: Offline, Syncing, Conflict Detected, Verified. User must always understand current connectivity and data state. 
### Track B - System Engineering & Core Functionality [70 Points]
Track B is divided into 8 engineering modules. Each module is independently scored. Teams are encouraged to prioritize modules by confidence; partial credit is awarded for demonstrably working sub-components. All modules must run locally (no cloud deployment required). 
**Module 1 - Secure Authentication & Identity Management [9 Points]**
Contestants must implement a mobile-first authentication system that functions without active internet access and complies with zero-trust identity principles. The login flow must not depend on third-party OAuth providers. 
 * **M1.1 Mobile OTP Generation (TOTP/HOTP) (3 Points)**
   * **Evaluation Criteria:** Generate time-based or HMAC-based OTPs locally using RFC 6238/4226. OTP must be valid offline. Demo must show expiry and re-generation. 
 * **M1.2 Asymmetric Key Pair Provisioning (3 Points)**
   * **Evaluation Criteria:** Upon first login, generate per-device RSA-2048 or Ed25519 key pair. Public key stored in shared ledger. Private key stored in device secure enclave or Keystore. 
 * **M1.3 Role-Based Access Control (RBAC) (2 Points)**
   * **Evaluation Criteria:** Roles: Field Volunteer, Supply Manager, Drone Operator, Camp Commander, Sync Admin. Each role has defined read/write/execute permissions enforced at the data layer. 
 * **M1.4 Audit Trail & Immutable Login Logs (1 Point)**
   * **Evaluation Criteria:** Every auth event (login, OTP failure, key rotation) is appended to a tamper-evident local log using hash chaining. Demonstrated by injecting a log corruption and detecting it. 
**Module 2 - Offline-First Distributed Database & CRDT Sync [10 Points]**
The system must operate as a fully distributed ledger across disconnected devices. When connectivity is restored (Bluetooth, Wi-Fi Direct, or cellular), all local databases must converge to an identical state with mathematical consistency guarantees; no central arbiter required. 
 * **M2.1 CRDT-Based Data Model (4 Points)**
   * **Evaluation Criteria:** Implement at minimum one of: G-Counter, OR-Set, LWW-Register, or RGA for supply inventory entries. Demonstrate that concurrent conflicting updates on two disconnected devices merge correctly upon reconnect. 
 * **M2.2 Vector Clock/Causal Ordering (3 Points)**
   * **Evaluation Criteria:** Every mutation carries a vector clock. Causal history must be preserved. Demonstrate: A writes, B reads A's write, B writes. Sync order must reflect causality. 
 * **M2.3 Conflict Visualization & Resolution (2 Points)**
   * **Evaluation Criteria:** When a genuine conflict is detected (same field updated concurrently), surface it in the UI with both values and a resolution mechanism. Log the resolution decision. 
 * **M2.4 Sync Protocol over Bluetooth/WiFi-Direct (1 Point)**
   * **Evaluation Criteria:** Actual device-to-device sync (not simulated). Delta-sync only: transmit changed records since last vector clock. Bandwidth overhead must be sub-10 KB per sync cycle under normal operation. 
**Module 3 - Ad-Hoc Mesh Network Protocol [9 Points]**
Devices must autonomously form a store-and-forward mesh network to relay encrypted supply data across physical dead zones. No Wi-Fi router or cellular tower should be required for intra-mesh communication. 
 * **M3.1 Store-and-Forward Message Relay (4 Points)**
   * **Evaluation Criteria:** Device A sends a message destined for Device C via Device B (relay). Message must survive Device B going offline mid-relay and resume when B comes back online. TTL and deduplication required. 
 * **M3.2 Dual-Role Node Architecture (3 Points)**
   * **Evaluation Criteria:** Each device dynamically acts as Client or Relay based on proximity, battery, and signal strength heuristics. Role switching must be automatic and logged. 
 * **M3.3 End-to-End Message Encryption (2 Points)**
   * **Evaluation Criteria:** All inter-node payloads encrypted using the recipient's public key (established in M1.2). Relay nodes must be cryptographically incapable of reading message contents. Demonstrate with packet inspection. 
**Module 4 - Multi-Modal Vehicle Routing Problem (VRP) Engine [10 Points]**
Implement a real-time, dynamic routing engine that optimizes delivery paths across a heterogeneous fleet (trucks, speedboats, drones) on a weighted graph representing roads, waterways, and airways. The graph must update live as field conditions change. 
 * **M4.1 Graph Representation & Multi-Modal Edge Types (3 Points)**
   * **Evaluation Criteria:** Model the logistics network as a weighted directed graph with at minimum 3 edge types: Road, Waterway, Airway. Edge weights encode travel time, capacity, and risk score. 
 * **M4.2 Dynamic Route Re-Computation on Node Failure (4 Points)**
   * **Evaluation Criteria:** When a field agent marks a road as 'Washed Out' or a river as 'Impassable,' the system recalculates all affected active routes within 2 seconds (measured). Use Dijkstra, A*, or equivalent with demonstrably correct shortest paths. 
 * **M4.3 Vehicle-Type Constraint Handling (2 Points)**
   * **Evaluation Criteria:** Routes are vehicle-specific: trucks only use road edges; speedboats only use waterway edges; drones only use airway edges with payload weight limits. Cross-mode transfers trigger a handoff event. 
 * **M4.4 Visual Route Dashboard (1 Point)**
   * **Evaluation Criteria:** Live map visualization (Leaflet.js + OSM tiles cached offline) showing all active routes, vehicle positions, and edge failure overlays, updating in real time during the demo. 
**Module 5 - Zero-Trust Proof-of-Delivery (PoD) System [7 Points]**
To prevent supply diversion and theft, every physical handoff between a driver and a recipient camp must be cryptographically verified - without any network connectivity. The handoff protocol must be non-repudiable. 
 * **M5.1 Signed QR Code Challenge-Response Handshake (3 Points)**
   * **Evaluation Criteria:** Driver generates a QR code containing: delivery_id, sender_pubkey, payload_hash, nonce, timestamp - all signed with driver's private key. Recipient scans and countersigns. Mutual verification without a server. 
 * **M5.2 Tamper-Evidence & Replay Protection (2 Points)**
   * **Evaluation Criteria:** Nonces are single-use and tracked locally. A replayed or tampered QR code must be rejected with a specific error code. Demonstrate by replaying a previously used QR code. 
 * **M5.3 Delivery Receipt Chain (2 Points)**
   * **Evaluation Criteria:** Each PoD receipt is appended to the CRDT ledger (Module 2) and propagated to all syncing nodes. The chain of custody for any package must be reconstructable from ledger history alone. 
**Module 6 - Autonomous Triage & Priority Preemption Engine [7 Points]**
Not all cargo has equal urgency. The system must autonomously evaluate delivery priorities in real time and make preemptive rescheduling decisions when route conditions deteriorate - without requiring a human dispatcher. 
 * **M6.1 Cargo Priority Taxonomy & SLA Windows (2 Points)**
   * **Evaluation Criteria:** Define at least 4 priority tiers with delivery SLA windows: P0 (Critical Medical, e.g. antivenom 2 hrs), P1 (High 6 hrs), P2 (Standard 24 hrs), P3 (Low 72 hrs). Stored in CRDT. 
 * **M6.2 Real-Time SLA Breach Prediction (3 Points)**
   * **Evaluation Criteria:** When a route slows by 30% or more (due to M4 updates or M7 predictions), the engine predicts if the current ETA will breach SLA for each cargo item and triggers a preemption evaluation. 
 * **M6.3 Autonomous Drop-and-Reroute Decision (2 Points)**
   * **Evaluation Criteria:** System autonomously instructs the driver to deposit P2/P3 cargo at a designated safe waypoint and reroute with P0/P1 cargo only. Decision and rationale logged to the audit trail. Simulated in the dashboard. 
**Module 7 - Predictive Route Decay (ML-Based) [9 Points]**
Rather than reacting to road failures, the system must proactively predict which routes are at risk of becoming impassable based on simulated environmental sensor data - and reroute vehicles before they encounter the failure. 
 * **M7.1 Rainfall Ingestion & Feature Engineering (2 Points)**
   * **Evaluation Criteria:** Ingest simulated rainfall rate data (CSV or mock sensor API at 1 Hz or higher). Extract features per graph edge: cumulative rainfall, rate-of-change, elevation, soil saturation proxy. 
 * **M7.2 Impassability Classification Model (3 Points)**
   * **Evaluation Criteria:** Train a binary classifier (logistic regression, decision tree, or gradient boosting) on the simulated dataset to predict edge impassability within the next 2 hours. Report precision, recall, and F1. Model must run on-device. 
 * **M7.3 Proactive Rerouting Integration (3 Points)**
   * **Evaluation Criteria:** Predictions from M7.2 are fed into the routing engine (M4). Edges predicted as high-risk (probability above 0.7) have their weights penalized. Affected drivers receive advance rerouting recommendations. 
 * **M7.4 Prediction Confidence Display (1 Point)**
   * **Evaluation Criteria:** Route map overlays edge color-coded by predicted risk. Hovering an edge shows the probability score, contributing features, and prediction timestamp. 
**Module 8 - Hybrid Fleet Orchestration & Drone Handoff Logic [9 Points]**
Design and implement the multi-agent coordination logic for seamless payload transfer between ground vehicles and autonomous drones for last-mile delivery to otherwise unreachable locations. 
 * **M8.1 Reachability Analysis (2 Points)**
   * **Evaluation Criteria:** Determine which delivery destinations are unreachable by boat or truck given current graph state. Classify them as 'Drone-Required Zones' and flag in the dashboard. 
 * **M8.2 Optimal Rendezvous Point Computation (3 Points)**
   * **Evaluation Criteria:** Given boat position, drone base, and destination, compute the geographic coordinate that minimizes total travel time for both agents to meet subject to drone range and payload weight constraints. Must be demonstrably correct on at least 3 test scenarios. 
 * **M8.3 Handoff Coordination Protocol (2 Points)**
   * **Evaluation Criteria:** Simulate the handoff event: boat arrives at rendezvous, generates a PoD receipt (Module 5), drone acknowledges with counter-signature, and payload ownership transfers in the CRDT ledger. 
 * **M8.4 Battery-Aware Mesh Throttling (2 Points)**
   * **Evaluation Criteria:** Background mesh broadcast frequency is dynamically adjusted based on battery level (below 30%: reduce frequency by 60%), accelerometer state (stationary: reduce by 80%), and proximity to known nodes. Demonstrate measurable battery savings in a 10-minute simulated run. 
### Section 2 - Mandatory Technical Constraints
Violation of any mandatory constraint results in automatic disqualification of the relevant module. Partial compliance earns partial credit at judge discretion. 
 * **C1 Inter-node Communication Protocol:** Protocol Buffers (Protobuf) mandatory for all node-to-node messages. JSON on the mesh network is strictly forbidden. REST/JSON permitted only for the developer dashboard UI.
 * **C2 Backend Language:** Sync server (when reachable) must be implemented in Go, Rust, or Elixir. Must demonstrate handling of 10,000+ simulated concurrent connections without data loss (load test via k6 or vegeta required).
 * **C3 Mobile RAM Budget:** All local edge processing logic (CRDT, routing, mesh relay) must consume less than 150 MB RAM on the mobile client. Measured via Android Studio Profiler or Xcode Instruments.
 * **C4 Offline Requirement:** 80% of all demo scenarios must execute with no internet access. Internet may only be used for initial sync and dashboard load. Judges will disable Wi-Fi during critical demo phases.
 * **C5 Cryptographic Standards:** RSA-2048 or Ed25519 for key pairs. AES-256-GCM for payload encryption. SHA-256 for all hash operations. No MD5, SHA-1, or DES. TLS 1.3 for any network channel.
 * **C6 Data Schema:** All data schemas must be defined in proto files checked into version control. Schema versioning (proto3 field numbering) must be respected. Breaking changes are forbidden during the 24-hour window. 
### Section 3 - Required Deliverables at Hour 24
All deliverables must be submitted via the official HackFusion submission portal before the 24-hour siren. Late submissions receive a 10-point deduction per 15 minutes. No exceptions. 
 * **D1 GitHub Repository:** Public repository with complete source code. Must include: README.md with setup instructions, /docs, judge architecture diagram in proto schema files, and a DEMO.md with step-by-step walkthrough instructions.
 * **D2 Working Prototype Demo:** Live demo on physical or emulated devices. Must demonstrate: offline sync (2 devices), route recalculation on failure injection, PoD handshake, and triage preemption all within a 10-minute time slot.
 * **D3 System Architecture Diagram:** A formal architecture diagram (draw.io, Lucidchart, or equivalent) clearly labeling all components, communication protocols, data flow for offline vs online modes, and your CAP Theorem trade-off choice (CP or AP) with justification.
 * **D4 ML Model Card (Module 7):** Document: model type, training dataset description, train/test split, F1/precision/recall metrics, and any edge-case considerations. Maximum 1 page PDF.
 * **D5 5-Minute Pitch Deck:** Maximum 10 slides. Must cover: problem framing, architecture overview, key engineering decisions, live demo result summary, and future roadmap. Submit as.pptx or.pdf.
 * **D6 Video Walkthrough (Optional, +3 Bonus Points):** A 3-5 minute screen-recorded walkthrough of all 8 modules. Clear narration required. Hosted on YouTube (unlisted) or submitted as MP4 not exceeding 200 MB. 
### Section 4 - Judging Rubric & Scoring Philosophy
Each module is evaluated independently by two judges. In case of disagreement exceeding 2 points, a chief judge breaks the tie. Scores are final once the evaluation committee signs off. 
**Rubric:**
 * **Track A- UI/UX & Frontend Design (30 Pts):** Visual polish, responsiveness, dashboard clarity, offline UX states, accessibility compliance.
 * **M1-Authentication & Identity (9 Pts):** OTP offline correctness, key provisioning security, RBAC enforcement, audit trail integrity.
 * **M2-Distributed DB & CRDT Sync (10 Pts):** Mathematical convergence proof, vector clock correctness, actual device sync demo, conflict resolution UX.
 * **M3-Ad-Hoc Mesh Networking (9 Pts):** Store-and-forward reliability, relay role switching, E2E encryption verification.
 * **M4-Multi-Modal VRP Routing (10 Pts):** Route correctness, re-computation speed (under 2s), vehicle constraint enforcement, live map visualization.
 * **M5-Zero-Trust Proof-of-Delivery (7 Pts):** Cryptographic correctness of QR handshake, replay attack demonstration, ledger chain integration.
 * **M6 - Triage & Priority Preemption (7 Pts):** SLA taxonomy completeness, breach prediction accuracy, autonomous rerouting decision quality.
 * **M7-Predictive Route Decay (ML) (9 Pts):** Feature engineering quality, classifier metrics (F1), on-device inference, proactive rerouting integration.
 * **M8- Hybrid Fleet & Drone Handoff (9 Pts):** Rendezvous computation correctness, handoff PoD integration, battery throttling measurability.
 * **Bonus-Video Walkthrough (D6) (+3 Pts):** Clarity, coverage of all modules, narration quality. 
**4.1 Scoring Bands:**
 * **90-100 (Outstanding):** All 8 modules fully working, production-quality UI, ML model with strong metrics, actual Bluetooth sync on physical devices.
 * **75-89 (Excellent):** 6-7 modules functional, solid engineering trade-offs, clear architecture documentation.
 * **60-74 (Proficient):** 4-5 modules working, identifiable gaps in either ML or sync, but demonstrates sound CS fundamentals.
 * **45-59 (Developing):** 3-4 modules partially functional, architectural choices present but not fully justified.
 * **Below 45 (Incomplete):** Fewer than 3 modules working or significant constraint violations. 
### Section 5 - Rules, Ethics & Code of Conduct
**5.1 Permitted Resources**
 * Open-source libraries, frameworks, and SDKs (must be declared in README).
 * Pre-trained ML model weights (must be documented in Model Card, D4).
 * Public APIs for map tiles (Leaflet.js + OpenStreetMap - cached offline).
 * Official documentation, Stack Overflow, and academic papers.
 * GitHub Copilot or similar AI pair-programming tools (must be declared). 
**5.2 Prohibited Actions**
 * Plagiarism - submitting pre-existing projects or substantially copied codebases.
 * Purchasing or contracting external developers to contribute code.
 * Using cloud-hosted databases or commercial backend services (Firebase, AWS RDS, etc.) as the primary data layer.
 * Misrepresenting AI-generated code as fully human-written without disclosure. 
**5.3 Academic Integrity**
Any team found in violation of the academic integrity policy will be immediately disqualified and reported to the respective university's department head. IEEE CS LU SB Chapter reserves the right to audit code history (git log) to verify authenticity. 
### Section 6 - Recommended Technology Stack
The following technologies are recommended, not mandatory (except gRPC/Protobuf). Teams may substitute alternatives with strong justification documented in their architecture diagram. 
 * **Mobile Client:** Flutter 3.x/React Native (Cross-platform; use flutter_blue_plus for Bluetooth mesh)
 * **Backend Sync Server:** Go (Fiber/gRPC) or Elixir (Phoenix) (Concurrency benchmarks required; Elixir GenServer for CRDT)
 * **Inter-node Protocol:** gRPC + Protobuf (MANDATORY) (No JSON on mesh; only on developer dashboard)
 * **Local Database:** SQLite custom CRDT layer / Realm (Must support offline schema migrations)
 * **Routing Engine:** NetworkX (Python) or custom Go graph (Wrap behind gRPC service; cache graph locally)
 * **ML/Prediction:** ONNX Runtime Mobile + scikit-learn ONNX export (on-device) (For Android/iOS inference)
 * **Cryptography:** libsodium / dart:crypto / Go crypto/rsa (Strictly follow C5 standards)
 * **Route Visualization:** Leaflet.js + react-leaflet + OSM tiles (Pre-cache tiles in IndexedDB for offline use)
 * **Load Testing:** k6 or vegeta (Required for C2 concurrency demonstration) 
### Section 7 - Suggested 24-Hour Timeline
Note: This timeline is advisory only. Teams manage their own time. It is provided to help teams avoid common pacing mistakes that lead to incomplete demos. 
 * **Hours 0-2 (Architecture Sprint):** Finalize proto schemas, agree on CRDT data model, sketch component graph, assign modules to team members.
 * **Hours 2-7 (Core Infrastructure):** M1 (Auth+OTP), M2 (CRDT + local DB), gRPC server skeleton, Protobuf definitions.
 * **Hours 7-13 (Feature Development):** M3 (Mesh relay), M4 (VRP routing engine), M5 (PoD QR handshake), M7 (ML data + training).
 * **Hours 13-18 (Integration & UI):** Track A (Dashboard + responsive UI), M6 (Triage engine), M7 integration with routing, M8 (drone handoff logic).
 * **Hours 18-22 (Testing & Hardening):** Integration testing, load test for C2, offline demo rehearsal, inject fault scenarios.
 * **Hours 22-24 (Submission & Pitch Prep):** README polish, architecture diagram, D4 Model Card, D5 pitch deck, push final commit. 
### Section 8 - Quick Reference: Points at a Glance
 * **Track A - UI/UX & Frontend Design:** 30 Pts (A1:6 + A2:6 + A3:8 + A4:5 + A5:5 = 30. Evaluated independently. No impact on Track B.)
 * **M1 - Authentication & Identity:** 9 Pts (OTP:3 + Key Provisioning:3 + RBAC:2 + Audit Trail:1)
 * **M2 - Distributed DB & CRDT Sync:** 10 Pts (CRDT Model:4 + Vector Clocks:3 + Conflict Resolution:2 + BT Sync:1)
 * **M3 - Ad-Hoc Mesh Networking:** 9 Pts (Store-Forward:4 + Dual Role:3 + E2E Encryption:2)
 * **M4 - Multi-Modal VRP Routing:** 10 Pts (Graph Model:3 + Dynamic Recompute:4 + Constraints:2 + Dashboard:1)
 * **M5 - Zero-Trust Proof-of-Delivery:** 7 Pts (QR Handshake:3 + Replay Protection:2 + Ledger Chain:2)
 * **M6 - Triage & Priority Preemption:** 7 Pts (Priority Taxonomy:2 + SLA Breach Prediction:3 + Auto Reroute:2)
 * **M7 - Predictive Route Decay (ML):** 9 Pts (Feature Engineering:2 + Classifier + Metrics:3 + Proactive Routing:3 + Visualization:1)
 * **M8 - Hybrid Fleet & Drone Handoff:** 9 Pts (Reachability:2 + Rendezvous Computation:3 + Handoff Protocol:2 + Battery Throttle:2)
 * **TOTAL (Track A + Track B):** 100 Pts (Bonus: +3 pts for Video Walkthrough D6) 
### Resources
Sylhet_map.json ->
```json
{
  "metadata": {
    "region": "Sylhet Division",
    "scenario": "Flash Flood Delta",
    "last_updated": "2026-04-12T08:00:00Z"
  },
  "nodes":,
  "edges":[
    { "id": "E1", "source": "N1", "target": "N2", "type": "road", "base_weight_mins": 20, "is_flooded": false },
    { "id": "E2", "source": "N1", "target": "N3", "type": "road", "base_weight_mins": 90, "is_flooded": false },
    { "id": "E3", "source": "N2", "target": "N4", "type": "road", "base_weight_mins": 45, "is_flooded": false },
    { "id": "E4", "source": "N1", "target": "N5", "type": "road", "base_weight_mins": 60, "is_flooded": false },
    { "id": "E5", "source": "N1", "target": "N6", "type": "road", "base_weight_mins": 120, "is_flooded": false },
    { "id": "E6", "source": "N1", "target": "N3", "type": "river", "base_weight_mins": 150, "is_flooded": false },
    { "id": "E7", "source": "N3", "target": "N4", "type": "river", "base_weight_mins": 50, "is_flooded": false }
  ]
}

```

Chaos_server.py ->
```python
import json
import random
import time
import threading
from flask import Flask, jsonify

app = Flask(__name__)
MAP_FILE = 'sylhet_map.json'

with open(MAP_FILE, 'r') as f:
    map_data = json.load(f)

def trigger_chaos():
    while True:
        time.sleep(30)
        safe_roads = [edge for edge in map_data['edges'] if edge['type'] == 'road' and not edge['is_flooded']]
        flooded_roads = [edge for edge in map_data['edges'] if edge['type'] == 'road' and edge['is_flooded']]
        event_type = random.choices(['flood', 'recede'], weights=[0.6, 0.4])
        
        if event_type == 'flood' and safe_roads:
            target = random.choice(safe_roads)
            target['is_flooded'] = True
            target['original_weight'] = target.get('base_weight_mins', 45)
            target['base_weight_mins'] = 9999
            print(f"CHAOS EVENT: Flood! Route {target['id']} ({target['source']} -> {target['target']}) is washed out!")
        elif event_type == 'recede' and flooded_roads:
            target = random.choice(flooded_roads)
            target['is_flooded'] = False
            target['base_weight_mins'] = target.get('original_weight', 45)
            print(f"CHAOS EVENT: Water receded! Route {target['id']} ({target['source']} -> {target['target']}) is now clear!")
        else:
            print("Chaos Engine: Water levels are stable this cycle.")

chaos_thread = threading.Thread(target=trigger_chaos, daemon=True)
chaos_thread.start()

@app.route('/api/network/status', methods=)
def get_network_status():
    """Returns the live map with current flood statuses and edge weights."""
    return jsonify(map_data)

@app.route('/api/network/reset', methods=)
def reset_network():
    """Judges/Teams can hit this to reset the map to sunny conditions."""
    global map_data
    with open(MAP_FILE, 'r') as f:
        map_data = json.load(f)
    return jsonify({"status": "Success", "message": "The floodwaters have receded. Map reset."})

if __name__ == '__main__':
    print("HackFusion 2026: Digital Delta Chaos API is running!")
    print("Endpoint available at: http://127.0.0.1:5000/api/network/status")
    app.run(debug=False, port=5000)

```

"The measure of an engineer is not the beauty of the algorithm on a whiteboard, but the reliability of the system is under pressure, at 3 AM, when the power flickers." - HackFusion 2026 Organizing Committee. 
Flyover presents HackFusion 2026 is organized by the IEEE Computer Society, Leading University SB Chapter. For queries, contact the organizing committee via the official event portal. Good luck - the clock starts now. 
