import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';

const WorkforcePage = lazy(() => import('./pages/Workforce'));
const UtilizationPage = lazy(() => import('./pages/Utilization'));
const ProjectsPage = lazy(() => import('./pages/Projects'));
const AllocationPage = lazy(() => import('./pages/Allocation'));
const FinancePage = lazy(() => import('./pages/Finance'));
const InsightsPage = lazy(() => import('./pages/Insights'));
const AssistantPage = lazy(() => import('./pages/Assistant'));
const CrmPage = lazy(() => import('./pages/Crm'));
const ForecastPage = lazy(() => import('./pages/Forecast'));
const ReportsPage = lazy(() => import('./pages/Reports'));
const DataPage = lazy(() => import('./pages/Data'));
const GovernancePage = lazy(() => import('./pages/Governance'));
const AdminPage = lazy(() => import('./pages/Admin'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const AccountPage = lazy(() => import('./pages/Account'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const MetricsPage = lazy(() => import('./pages/Metrics'));

function Guard({ children, perm }) {
  const { loading, signedIn, can } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-10"><Loading rows={4} /></div>;
  if (!signedIn) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (perm && !can(perm)) {
    return (
      <div className="card card-pad max-w-xl mx-auto mt-10 text-center">
        <h2 className="text-base font-semibold text-ink-900">You do not have access to this area</h2>
        <p className="text-sm text-ink-500 mt-1">
          Your role does not include the permission required for this screen. Ask your organization administrator
          if you need access. This restriction is enforced by the server as well as the interface.
        </p>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { loading, signedIn } = useAuth();
  if (loading) return <div className="p-10"><Loading rows={5} label="Loading your workspace…" /></div>;

  return (
    <Routes>
      <Route path="/login" element={signedIn ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/*"
        element={(
          <Layout>
            <Suspense fallback={<Loading rows={4} />}>
              <Routes>
                <Route path="/" element={<Guard perm={['analytics.utilization', 'analytics.executive']}><DashboardPage /></Guard>} />
                <Route path="/workforce" element={<Guard perm="workforce.view"><WorkforcePage /></Guard>} />
                <Route path="/utilization" element={<Guard perm="analytics.utilization"><UtilizationPage /></Guard>} />
                <Route path="/projects" element={<Guard perm="project.view"><ProjectsPage /></Guard>} />
                <Route path="/allocation" element={<Guard perm="allocation.view"><AllocationPage /></Guard>} />
                <Route path="/finance" element={<Guard perm={['finance.view', 'workforce.cost.view']}><FinancePage /></Guard>} />
                <Route path="/insights" element={<Guard perm="ai.insights"><InsightsPage /></Guard>} />
                <Route path="/assistant" element={<Guard perm="ai.assistant"><AssistantPage /></Guard>} />
                <Route path="/crm" element={<Guard perm="crm.view"><CrmPage /></Guard>} />
                <Route path="/forecast" element={<Guard perm="forecast.view"><ForecastPage /></Guard>} />
                <Route path="/reports" element={<Guard perm="report.view"><ReportsPage /></Guard>} />
                <Route path="/data" element={<Guard perm="import.manage"><DataPage /></Guard>} />
                <Route path="/governance" element={<Guard perm={['automation.manage', 'approval.manage']}><GovernancePage /></Guard>} />
                <Route path="/admin" element={<Guard perm={['org.view', 'user.view', 'audit.view']}><AdminPage /></Guard>} />
                <Route path="/settings" element={<Guard><SettingsPage /></Guard>} />
                <Route path="/account" element={<Guard><AccountPage /></Guard>} />
                <Route path="/notifications" element={<Guard><NotificationsPage /></Guard>} />
                <Route path="/metrics" element={<Guard><MetricsPage /></Guard>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </Layout>
        )}
      />
    </Routes>
  );
}
