import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import MoneyPage from '@/pages/MoneyPage'
import HouseholdPage from '@/pages/HouseholdPage'
import FinancesPage from '@/pages/FinancesPage'
import ProfilePage from '@/pages/ProfilePage'
import AdminUsersPage from '@/pages/AdminUsersPage'
import NotificationsPage from '@/pages/NotificationsPage'
import PendingMovementsPage from '@/pages/PendingMovementsPage'

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

/**
 * Fijos, Gastos adicionales and Ingresos became one screen (Mi dinero). Their old addresses still work, from
 * bookmarks, notifications and the Telegram bot: each opens Mi dinero on what it used to show.
 */
function ToMoney({ kind }: { kind?: 'additional' | 'income' }) {
  const { search } = useLocation()
  const old = new URLSearchParams(search)
  const next = new URLSearchParams()
  if (old.get('tab') === 'config') next.set('vista', 'config')
  if (kind) next.set('tipo', kind)
  const q = next.toString()
  return <Navigate to={`/dinero${q ? `?${q}` : ''}`} replace />
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
      { path: 'dinero',       element: <MoneyPage /> },
      { path: 'gastos',       element: <ToMoney kind="additional" /> },
      { path: 'fijos',        element: <ToMoney /> },
      { path: 'hogar',        element: <HouseholdPage /> },
      { path: 'finanzas',     element: <FinancesPage /> },
      { path: 'ingresos',     element: <ToMoney kind="income" /> },
      ...(SeedPage ? [{ path: 'seed', element: <Suspense fallback={null}><SeedPage /></Suspense> }] : []),
      { path: 'notificaciones', element: <NotificationsPage /> },
      { path: 'pendientes',     element: <PendingMovementsPage /> },
      { path: 'perfil',        element: <ProfilePage /> },
      { path: 'usuarios',      element: <RequireAdmin><AdminUsersPage /></RequireAdmin> },
    ],

  },
])
