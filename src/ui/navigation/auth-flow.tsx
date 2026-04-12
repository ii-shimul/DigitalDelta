import type { DashboardScreenData, LoginScreenData } from '../../api';
import { AuthScreen } from '../screens/auth';

type AuthFlowProps = {
  loginData: LoginScreenData;
  dashboardData: DashboardScreenData;
};

export function AuthFlow({ loginData, dashboardData }: AuthFlowProps) {
  return <AuthScreen loginData={loginData} dashboardData={dashboardData} />;
}
