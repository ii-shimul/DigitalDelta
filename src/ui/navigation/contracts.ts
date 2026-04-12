export const APP_SCREENS = [
  'Login',
  'Dashboard',
  'RouteDetails',
  'DeliveryDetails',
  'SyncStatus',
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
  | 'dashboard'
  | 'route-details'
  | 'delivery-details'
  | 'sync-status'
  | 'handoff-flow';

export type AppRouteParamList = {
  Login: undefined;
  Dashboard:
    | {
        focusDeliveryId?: string;
        highlightState?: DashboardStateHighlight;
      }
    | undefined;
  RouteDetails: {
    deliveryId: string;
    routeId: string;
    from?: RouteOrigin;
  };
  DeliveryDetails: {
    deliveryId: string;
    openScanner?: boolean;
    from?: RouteOrigin;
  };
  SyncStatus:
    | {
        peerDeviceId?: string;
        phase?: SyncPhaseRouteParam;
      }
    | undefined;
  HandoffFlow: {
    deliveryId: string;
    handoffId?: string;
    from?: RouteOrigin;
  };
};

export type NavigationGraph = Record<AppScreen, readonly AppScreen[]>;

export const NAVIGATION_GRAPH: NavigationGraph = {
  Login: ['Dashboard'],
  Dashboard: ['RouteDetails', 'DeliveryDetails', 'SyncStatus', 'HandoffFlow'],
  RouteDetails: ['Dashboard', 'DeliveryDetails', 'SyncStatus', 'HandoffFlow'],
  DeliveryDetails: ['Dashboard', 'RouteDetails', 'SyncStatus', 'HandoffFlow'],
  SyncStatus: ['Dashboard', 'RouteDetails', 'DeliveryDetails', 'HandoffFlow'],
  HandoffFlow: ['Dashboard', 'RouteDetails', 'DeliveryDetails', 'SyncStatus'],
};

export const PRIMARY_DEMO_FLOW: readonly AppScreen[] = [
  'Login',
  'Dashboard',
  'RouteDetails',
  'DeliveryDetails',
  'SyncStatus',
  'HandoffFlow',
];

export const OFFLINE_CRITICAL_SCREENS: readonly AppScreen[] = [
  'Dashboard',
  'RouteDetails',
  'DeliveryDetails',
  'SyncStatus',
  'HandoffFlow',
];
