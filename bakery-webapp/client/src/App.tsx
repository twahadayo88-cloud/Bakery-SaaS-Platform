import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import AdminLayout from './components/layouts/AdminLayout';

// Lazy load admin pages
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const ClientList = lazy(() => import('./pages/admin/ClientList'));
const ClientDetail = lazy(() => import('./pages/admin/ClientDetail'));
const Analytics = lazy(() => import('./pages/admin/Analytics'));
const Subscriptions = lazy(() => import('./pages/admin/Subscriptions'));
const FinancialReports = lazy(() => import('./pages/admin/FinancialReports'));
const Onboarding = lazy(() => import('./pages/admin/Onboarding'));
const Announcements = lazy(() => import('./pages/admin/Announcements'));
const AuditLog = lazy(() => import('./pages/admin/AuditLog'));
const Settings = lazy(() => import('./pages/admin/Settings'));

// Lazy load baker app pages
const BakerApp = lazy(() => import('./pages/baker/App'));
const BakerMobile = lazy(() => import('./pages/baker/Mobile'));
const BakerOnboarding = lazy(() => import('./pages/baker/Onboarding'));

// Loading skeleton
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-950">
      <div className="text-surface-400">Loading...</div>
    </div>
  );
}

// Protected route component
function ProtectedRoute({ children, requiredRole, allowIncompleteOnboarding = false }: { children: React.ReactNode; requiredRole?: string; allowIncompleteOnboarding?: boolean }) {
  const { user, organization, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (requiredRole && user.role !== requiredRole) return <Navigate to="/" replace />;
  if (!allowIncompleteOnboarding && user.role === 'baker' && organization?.onboarding_status === 'in_progress') return <Navigate to="/onboarding" replace />;

  return <>{children}</>;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user, organization, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin' || organization?.onboarding_status !== 'in_progress') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// Root redirect — logged in users go straight to their workspace
function Home() {
  const { user, organization, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  return <Navigate to={user.role === 'admin' ? '/admin' : organization?.onboarding_status === 'in_progress' ? '/onboarding' : '/app'} replace />;
}

function DashboardRedirect() {
  return <Home />;
}

export default function App() {
  return (
    <Routes>
      {/* Login */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Login />} />

      {/* Admin Portal */}
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute requiredRole="admin" allowIncompleteOnboarding>
            <AdminLayout>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<AdminDashboard />} />
                  <Route path="/clients" element={<ClientList />} />
                  <Route path="/clients/:id" element={<ClientDetail />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/subscriptions" element={<Subscriptions />} />
                  <Route path="/financial" element={<FinancialReports />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/announcements" element={<Announcements />} />
                  <Route path="/audit-log" element={<AuditLog />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Suspense>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Baker App */}
      <Route
        path="/app/*"
        element={
          <ProtectedRoute requiredRole="baker">
            <Suspense fallback={<PageLoader />}>
              <BakerApp />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Baker Mobile */}
      <Route
        path="/m/*"
        element={
          <ProtectedRoute requiredRole="baker">
            <Suspense fallback={<PageLoader />}>
              <BakerMobile />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/onboarding"
        element={
          <ProtectedRoute requiredRole="baker" allowIncompleteOnboarding={true}>
            <Suspense fallback={<PageLoader />}><OnboardingGuard><BakerOnboarding /></OnboardingGuard></Suspense>
          </ProtectedRoute>
        }
      />

      {/* Root — straight to workspace if logged in, login if not */}
      <Route path="/" element={<Home />} />
      <Route path="/dashboard" element={<DashboardRedirect />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
