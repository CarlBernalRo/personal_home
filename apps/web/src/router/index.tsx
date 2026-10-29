import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import ExpensesPage from '@/pages/ExpensesPage'
import FixedExpensesPage from '@/pages/FixedExpensesPage'
import HouseholdPage from '@/pages/HouseholdPage'
import FinancesPage from '@/pages/FinancesPage'
import SeedPage from '@/pages/SeedPage'
import ProfilePage from '@/pages/ProfilePage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Cargando…</p>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
      <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
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
      { path: 'seed',          element: <SeedPage /> },
      { path: 'perfil',        element: <ProfilePage /> },
    ],
  },
])
