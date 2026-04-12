import {
  getDashboardScreenData,
  getLoginScreenData,
  type DashboardScreenData,
  type LoginScreenData,
} from '../api';
import {
  getPhase0DemoScenario,
  PHASE0_DEMO_SCENARIO_ID,
  seedPhase0DemoData,
} from '../db';

export type ManualDemoSetupResult = {
  scenarioId: string;
  seededAtMs: number;
  loginData: LoginScreenData;
  dashboardData: DashboardScreenData;
};

export async function runManualDemoSetup(): Promise<ManualDemoSetupResult> {
  const scenario = getPhase0DemoScenario();

  await seedPhase0DemoData();

  const loginData = await getLoginScreenData({
    userId: scenario.users[0].userId,
    deviceId: scenario.deviceIdentities[0].deviceId,
  });

  const dashboardData = await getDashboardScreenData();

  if (!loginData) {
    throw new Error('Manual demo setup failed to load login data.');
  }

  return {
    scenarioId: PHASE0_DEMO_SCENARIO_ID,
    seededAtMs: Date.now(),
    loginData,
    dashboardData,
  };
}
