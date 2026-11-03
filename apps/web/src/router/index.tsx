import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import ExpensesPage from '@/pages/ExpensesPage'
import FixedExpensesPage from '@/pages/FixedExpensesPage'
import HouseholdPage from '@/pages/HouseholdPage'
import FinancesPage from '@/pages/FinancesPage'
import ProfilePage from '@/pages/ProfilePage'
import AdminUsersPage from '@/pages/AdminUsersPage'
import NotificationsPage from '@/pages/NotificationsPage'

// The seeding tool holds personal data (e-mails, account numbers, the original Excel): it exists only in development.
// `import.meta.env.DEV` is false in a production build, so this branch, the page and its data never reach the bundle.
const SeedPage = import.meta.env.DEV ? lazy(() => import('@/pages/SeedPage')) : null

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1114]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
        <p className="text-sm text-[#8a929a] font-mono">Cargando…</p>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth()
  if (loading) return null
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1114]">
      <div className="w-10 h-10 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
    </div>
  )
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <RedirectIfAuth><LoginPage /></RedirectIfAuth>,
  },
  {
    path: '/',
    element: <RequireAuth><Layout /></RequireAuth>,
    children: [
      { index: true,          element: <DashboardPage /> },
      { path: 'gastos',       element: <ExpensesPage /> },
      { path: 'fijos',        element: <FixedExpensesPage /> },
      { path: 'hogar',        element: <HouseholdPage /> },
      { path: 'finanzas',     element: <FinancesPage /> },
      ...(SeedPage ? [{ path: 'seed', element: <Suspense fallback={null}><SeedPage /></Suspense> }] : []),
      { path: 'notificaciones', element: <NotificationsPage /> },
      { path: 'perfil',        element: <ProfilePage /> },
      { path: 'usuarios',      element: <RequireAdmin><AdminUsersPage /></RequireAdmin> },
    ],

  },
])
