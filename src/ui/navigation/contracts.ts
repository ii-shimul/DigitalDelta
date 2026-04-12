export const BOTTOM_TAB_SCREENS = [
  'Command',
  'Inventory',
  'Scanner',
  'Mesh',
  'Identity',
] as const;

export type BottomTabScreen = (typeof BOTTOM_TAB_SCREENS)[number];

export const APP_SCREENS = [
  'Login',
  ...BOTTOM_TAB_SCREENS,
  'HandoffFlow',
] as const;

export type AppScreen = (typeof APP_SCREENS)[number];

export type DashboardStateHighlight =
  | 'offline'
  | 'syncing'
  | 'conflict-detected'
  | 'verified';

export type SyncPhaseRouteParam =
  | 'discovering'
  | 'exchanging'
  | 'applying'
  | 'complete'
  | 'failed';

export type RouteOrigin =
  | 'command'
  | 'inventory'
  | 'scanner'
  | 'mesh'
  | 'identity'
  | 'handoff-flow';

export type AppRouteParamList = {
  Login: undefined;
  Command:
    | {
        focusDeliveryId?: string;
        highlightState?: DashboardStateHighlight;
      }
    | undefined;
  Inventory: {
    focusConflictId?: string;
    from?: RouteOrigin;
  };
  Scanner: {
    openCamera?: boolean;
    from?: RouteOrigin;
  };
  Mesh:
    | {
        peerDeviceId?: string;
        phase?: SyncPhaseRouteParam;
      }
    | undefined;
  Identity: undefined;
  HandoffFlow: {
    deliveryId: string;
    handoffId?: string;
    from?: RouteOrigin;
  };
};

export type NavigationGraph = Record<AppScreen, readonly AppScreen[]>;

export const NAVIGATION_GRAPH: NavigationGraph = {
  Login: [...BOTTOM_TAB_SCREENS],
  Command: ['Inventory', 'Scanner', 'Mesh', 'Identity', 'HandoffFlow'],
  Inventory: ['Command', 'Scanner', 'Mesh', 'Identity', 'HandoffFlow'],
  Scanner: ['Command', 'Inventory', 'Mesh', 'Identity', 'HandoffFlow'],
  Mesh: ['Command', 'Inventory', 'Scanner', 'Identity', 'HandoffFlow'],
  Identity: ['Command', 'Inventory', 'Scanner', 'Mesh', 'HandoffFlow'],
  HandoffFlow: [...BOTTOM_TAB_SCREENS],
};

export const PRIMARY_DEMO_FLOW: readonly AppScreen[] = [
  'Login',
  ...BOTTOM_TAB_SCREENS,
  'HandoffFlow',
];

export const OFFLINE_CRITICAL_SCREENS: readonly AppScreen[] = [
  ...BOTTOM_TAB_SCREENS,
  'HandoffFlow',
];
