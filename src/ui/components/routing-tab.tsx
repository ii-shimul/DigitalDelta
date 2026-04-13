import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import {
  type EdgeStatus,
  type GraphEdge,
  type RouteResult,
  type VehicleType,
  computeRoute,
  getEdges,
  getNodes,
  markEdge,
  resetAllEdges,
  seedRoutingGraph,
} from '../../api/routing';
import type { GraphNode } from '../../core/routing/engine';

const VEHICLE_ICONS: Record<VehicleType, string> = {
  truck: '🚛',
  speedboat: '⛵',
  drone: '🚁',
};

const VEHICLE_LABELS: Record<VehicleType, string> = {
  truck: 'Truck (Road only)',
  speedboat: 'Speedboat (Waterway only)',
  drone: 'Drone (Airway only)',
};

const EDGE_STATUS_COLOR: Record<EdgeStatus, string> = {
  clear: '#38a169',
  flooded: '#e53e3e',
  impassable: '#e53e3e',
  high_risk: '#d69e2e',
};

const EDGE_TYPE_STYLE: Record<string, string> = {
  road: '#0058be',
  waterway: '#3182ce',
  airway: '#805ad5',
};

// Map node IDs to screen-space positions for the SVG diagram
const NODE_POS: Record<string, { x: number; y: number }> = {
  N1: { x: 280, y: 150 },
  N2: { x: 130, y: 80 },
  N3: { x: 80, y: 220 },
  N4: { x: 180, y: 310 },
  N5: { x: 340, y: 310 },
  N6: { x: 400, y: 200 },
  N7: { x: 280, y: 50 },
};

function buildMapHtml(
  nodes: GraphNode[],
  edges: GraphEdge[],
  routeEdgeIds: string[],
): string {
  const W = 480;
  const H = 400;

  const edgeLines = edges
    .map(e => {
      const s = NODE_POS[e.sourceNodeId];
      const t = NODE_POS[e.targetNodeId];
      if (!s || !t) {
        return '';
      }
      const isRoute = routeEdgeIds.includes(e.edgeId);
      const baseColor =
        e.status === 'flooded' || e.status === 'impassable'
          ? '#e53e3e'
          : e.status === 'high_risk'
          ? '#d69e2e'
          : EDGE_TYPE_STYLE[e.edgeType] ?? '#888';
      const color = isRoute ? '#facc15' : baseColor;
      const width = isRoute ? 5 : 2;
      const dash =
        e.edgeType === 'waterway'
          ? 'stroke-dasharray="8,4"'
          : e.edgeType === 'airway'
          ? 'stroke-dasharray="4,4"'
          : '';
      const opacity =
        e.status === 'flooded' || e.status === 'impassable' ? 0.5 : 1;
      // Mid-point label
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2;
      const label =
        e.status === 'flooded'
          ? '🌊'
          : e.status === 'impassable'
          ? '🚫'
          : e.status === 'high_risk'
          ? '⚠'
          : '';

      return `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${
        t.y
      }" stroke="${color}" stroke-width="${width}" ${dash} opacity="${opacity}"/>
${
  label
    ? `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="middle" font-size="12">${label}</text>`
    : ''
}`;
    })
    .join('\n');

  const nodeCircles = nodes
    .map(n => {
      const pos = NODE_POS[n.nodeId];
      if (!pos) {
        return '';
      }
      const isRouteNode = false; // highlight handled by edge color
      const fill =
        n.nodeType === 'depot'
          ? '#0058be'
          : n.nodeType === 'hospital'
          ? '#e53e3e'
          : n.nodeType === 'drone_base'
          ? '#805ad5'
          : '#38a169';
      return `<circle cx="${pos.x}" cy="${
        pos.y
      }" r="18" fill="${fill}" stroke="white" stroke-width="2"/>
<text x="${pos.x}" y="${
        pos.y
      }" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="white" font-weight="bold">${
        n.nodeId
      }</text>
<text x="${pos.x}" y="${
        pos.y + 30
      }" text-anchor="middle" font-size="9" fill="#555">${
        n.displayName.split(' ')[0]
      }</text>`;
    })
    .join('\n');

  const legend = `
<rect x="10" y="${
    H - 80
  }" width="160" height="72" fill="white" rx="6" opacity="0.9"/>
<line x1="18" y1="${H - 65}" x2="42" y2="${H - 65}" stroke="${
    EDGE_TYPE_STYLE.road
  }" stroke-width="2"/><text x="48" y="${
    H - 61
  }" font-size="9" fill="#333">Road (Truck)</text>
<line x1="18" y1="${H - 50}" x2="42" y2="${H - 50}" stroke="${
    EDGE_TYPE_STYLE.waterway
  }" stroke-width="2" stroke-dasharray="8,4"/><text x="48" y="${
    H - 46
  }" font-size="9" fill="#333">Waterway (Boat)</text>
<line x1="18" y1="${H - 35}" x2="42" y2="${H - 35}" stroke="${
    EDGE_TYPE_STYLE.airway
  }" stroke-width="2" stroke-dasharray="4,4"/><text x="48" y="${
    H - 31
  }" font-size="9" fill="#333">Airway (Drone)</text>
<line x1="18" y1="${H - 20}" x2="42" y2="${
    H - 20
  }" stroke="#facc15" stroke-width="4"/><text x="48" y="${
    H - 16
  }" font-size="9" fill="#333">Active Route</text>
`;

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{margin:0;padding:0;background:#f0f4ff;}svg{display:block;}</style>
</head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#e8eef8;">
  ${edgeLines}
  ${nodeCircles}
  ${legend}
</svg>
</body></html>`;
}

export function RoutingTab() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>('truck');
  const [sourceNode, setSourceNode] = useState('N1');
  const [destNode, setDestNode] = useState('N4');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  const load = useCallback(async () => {
    await seedRoutingGraph();
    const [n, e] = await Promise.all([getNodes(), getEdges()]);
    setNodes(n);
    setEdges(e);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
      const [n, e] = await Promise.all([getNodes(), getEdges()]);
      setNodes(n);
      setEdges(e);
      setMapKey(k => k + 1);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Unknown');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleComputeRoute = useCallback(() => {
    run(async () => {
      const start = Date.now();
      const result = await computeRoute(sourceNode, destNode, selectedVehicle);
      setRoute(result);
      if (!result.found) {
        Alert.alert(
          'No Route Found',
          `No ${selectedVehicle} route from ${sourceNode} to ${destNode}.\nCheck edge types and flood status.`,
        );
      }
    });
  }, [sourceNode, destNode, selectedVehicle, run]);

  const handleMarkEdge = useCallback(
    (edgeId: string, status: EdgeStatus) => {
      run(async () => {
        await markEdge(
          edgeId,
          status,
          status === 'flooded'
            ? 'Flash flood — route impassable'
            : status === 'clear'
            ? 'Waters receded — route restored'
            : 'High risk — elevated flood prediction',
        );
        // Re-compute route with updated graph
        if (route) {
          const updated = await computeRoute(
            sourceNode,
            destNode,
            selectedVehicle,
          );
          setRoute(updated);
        }
      });
    },
    [run, route, sourceNode, destNode, selectedVehicle],
  );

  const handleReset = useCallback(() => {
    run(async () => {
      await resetAllEdges();
      setRoute(null);
    });
  }, [run]);

  const routeEdgeIds = route?.edgeIds ?? [];
  const mapHtml = buildMapHtml(nodes, edges, routeEdgeIds);

  const roadEdges = edges.filter(e => e.edgeType === 'road');
  const waterEdges = edges.filter(e => e.edgeType === 'waterway');
  const clearNodes = nodes.filter(n => n.nodeId !== 'N1' && n.nodeId !== 'N7');

  return (
    <View>
      {/* Header */}
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>DIJKSTRA · MULTI-MODAL · REAL-TIME</Text>
        <Text style={styles.title}>VRP Routing Engine</Text>
        <Text style={styles.subtitle}>
          Road, waterway, and airway edges with vehicle-type constraints. Mark
          edges flooded to trigger instant re-computation.
        </Text>
      </View>

      {/* Network Map */}
      <View style={styles.mapContainer}>
        <WebView
          key={mapKey}
          source={{ html: mapHtml }}
          style={styles.mapWebView}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* Vehicle selector */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Vehicle Type (M4.3)</Text>
        <View style={styles.chipRow}>
          {(['truck', 'speedboat', 'drone'] as VehicleType[]).map(vt => (
            <TouchableOpacity
              key={vt}
              style={[styles.chip, selectedVehicle === vt && styles.chipActive]}
              onPress={() => setSelectedVehicle(vt)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.chipText,
                  selectedVehicle === vt && styles.chipTextActive,
                ]}
              >
                {VEHICLE_ICONS[vt]} {vt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.constraintHint}>
          {selectedVehicle === 'truck' && '📍 Trucks use road edges only'}
          {selectedVehicle === 'speedboat' &&
            '📍 Speedboats use waterway edges only'}
          {selectedVehicle === 'drone' &&
            '📍 Drones use airway edges only (from N7)'}
        </Text>
      </View>

      {/* Source → Destination */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Route Query</Text>
        <View style={styles.routeRow}>
          <View style={styles.routeHalf}>
            <Text style={styles.routeLabel}>From</Text>
            <View style={styles.nodeChips}>
              {nodes
                .filter(n => n.nodeId !== 'N7' || selectedVehicle === 'drone')
                .map(n => (
                  <TouchableOpacity
                    key={n.nodeId}
                    style={[
                      styles.nodeChip,
                      sourceNode === n.nodeId && styles.nodeChipActive,
                    ]}
                    onPress={() => setSourceNode(n.nodeId)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.nodeChipText,
                        sourceNode === n.nodeId && styles.nodeChipTextActive,
                      ]}
                    >
                      {n.nodeId}
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
          <Text style={styles.arrow}>→</Text>
          <View style={styles.routeHalf}>
            <Text style={styles.routeLabel}>To</Text>
            <View style={styles.nodeChips}>
              {clearNodes.map(n => (
                <TouchableOpacity
                  key={n.nodeId}
                  style={[
                    styles.nodeChip,
                    destNode === n.nodeId && styles.nodeChipActive,
                  ]}
                  onPress={() => setDestNode(n.nodeId)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.nodeChipText,
                      destNode === n.nodeId && styles.nodeChipTextActive,
                    ]}
                  >
                    {n.nodeId}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.btnPrimary, loading && styles.btnDisabled]}
        onPress={handleComputeRoute}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Text style={styles.btnPrimaryText}>
          {loading
            ? 'Computing…'
            : `${VEHICLE_ICONS[selectedVehicle]} Compute Shortest Route`}
        </Text>
      </TouchableOpacity>

      {/* Route result */}
      {route && (
        <View
          style={[
            styles.resultCard,
            { borderColor: route.found ? '#38a169' : '#e53e3e' },
          ]}
        >
          <View style={styles.resultTop}>
            <Text style={styles.resultTitle}>
              {route.found ? '✓ Route Found' : '✗ No Route Available'}
            </Text>
            <Text style={styles.resultTime}>
              {route.found
                ? `${Math.round(route.totalTimeMinutes)} min`
                : 'N/A'}
            </Text>
          </View>
          {route.found && (
            <>
              <Text style={styles.resultPath}>
                Path: {route.path.join(' → ')}
              </Text>
              <Text style={styles.resultMeta}>
                Computed in {route.computedInMs}ms · {route.edgeIds.length} edge
                {route.edgeIds.length !== 1 ? 's' : ''}
              </Text>
            </>
          )}
        </View>
      )}

      {/* Edge failure injection (M4.2) */}
      <View style={[styles.section, { marginTop: 20 }]}>
        <Text style={styles.sectionTitle}>Inject Edge Failure (M4.2)</Text>
        <Text style={styles.sectionSub}>
          Mark a road or waterway as flooded — route re-computes instantly
          (&lt;2s).
        </Text>
        <Text style={styles.edgeGroupLabel}>🚛 Road Edges</Text>
        {roadEdges.map(e => (
          <EdgeRow
            key={e.edgeId}
            edge={e}
            nodes={nodes}
            onMark={handleMarkEdge}
            loading={loading}
          />
        ))}
        <Text style={[styles.edgeGroupLabel, { marginTop: 8 }]}>
          ⛵ Waterway Edges
        </Text>
        {waterEdges.map(e => (
          <EdgeRow
            key={e.edgeId}
            edge={e}
            nodes={nodes}
            onMark={handleMarkEdge}
            loading={loading}
          />
        ))}
      </View>

      <TouchableOpacity
        style={[styles.btnSecondary, loading && styles.btnDisabled]}
        onPress={handleReset}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Text style={styles.btnSecondaryText}>↺ Reset All Edges to Clear</Text>
      </TouchableOpacity>
    </View>
  );
}

function EdgeRow({
  edge,
  nodes,
  onMark,
  loading,
}: {
  edge: GraphEdge;
  nodes: GraphNode[];
  onMark: (edgeId: string, status: EdgeStatus) => void;
  loading: boolean;
}) {
  const src = nodes.find(n => n.nodeId === edge.sourceNodeId);
  const tgt = nodes.find(n => n.nodeId === edge.targetNodeId);
  const statusColor = EDGE_STATUS_COLOR[edge.status];
  const isAffected = edge.status !== 'clear';

  return (
    <View style={styles.edgeRow}>
      <View style={styles.edgeInfo}>
        <View
          style={[styles.edgeStatusDot, { backgroundColor: statusColor }]}
        />
        <Text style={styles.edgeLabel} numberOfLines={1}>
          {edge.edgeId}: {src?.nodeId ?? '?'} → {tgt?.nodeId ?? '?'}{' '}
          <Text style={styles.edgeTime}>({edge.travelTimeMinutes}min)</Text>
        </Text>
      </View>
      <View style={styles.edgeActions}>
        {isAffected ? (
          <TouchableOpacity
            style={styles.edgeBtnClear}
            onPress={() => onMark(edge.edgeId, 'clear')}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.edgeBtnClearText}>Clear</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.edgeBtnFlood}
            onPress={() => onMark(edge.edgeId, 'flooded')}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.edgeBtnFloodText}>🌊 Flood</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: 16 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: '#0058be',
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#131b2e', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#565e74', lineHeight: 19 },
  mapContainer: {
    height: 300,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  mapWebView: { flex: 1, backgroundColor: '#e8eef8' },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 6,
  },
  sectionSub: { fontSize: 12, color: '#9da3b0', marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f2f3ff',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  chipActive: { backgroundColor: '#0058be', borderColor: '#0058be' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#565e74' },
  chipTextActive: { color: '#fff' },
  constraintHint: { fontSize: 11, color: '#0058be', fontStyle: 'italic' },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  routeHalf: { flex: 1 },
  routeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9da3b0',
    marginBottom: 4,
  },
  nodeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  nodeChip: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f2f3ff',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  nodeChipActive: { backgroundColor: '#131b2e', borderColor: '#131b2e' },
  nodeChipText: { fontSize: 12, fontWeight: '700', color: '#565e74' },
  nodeChipTextActive: { color: '#fff' },
  arrow: { fontSize: 20, color: '#131b2e', paddingTop: 22 },
  btnPrimary: {
    backgroundColor: '#0058be',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#f2f3ff',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  btnSecondaryText: { color: '#131b2e', fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  resultCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 4,
    borderWidth: 2,
    backgroundColor: '#f8f9ff',
    gap: 6,
  },
  resultTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultTitle: { fontSize: 14, fontWeight: '800', color: '#131b2e' },
  resultTime: { fontSize: 18, fontWeight: '800', color: '#0058be' },
  resultPath: {
    fontSize: 13,
    fontWeight: '600',
    color: '#131b2e',
    fontFamily: 'monospace',
  },
  resultMeta: { fontSize: 11, color: '#9da3b0' },
  edgeGroupLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#565e74',
    marginBottom: 6,
  },
  edgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9ff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 5,
    borderWidth: 1,
    borderColor: '#e4e6f0',
  },
  edgeInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  edgeStatusDot: { width: 8, height: 8, borderRadius: 4 },
  edgeLabel: { fontSize: 12, color: '#131b2e', flex: 1 },
  edgeTime: { color: '#9da3b0', fontSize: 11 },
  edgeActions: {},
  edgeBtnFlood: {
    backgroundColor: '#fff5f5',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#e53e3e',
  },
  edgeBtnFloodText: { color: '#e53e3e', fontSize: 11, fontWeight: '700' },
  edgeBtnClear: {
    backgroundColor: '#f0fff4',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#38a169',
  },
  edgeBtnClearText: { color: '#38a169', fontSize: 11, fontWeight: '700' },
});
