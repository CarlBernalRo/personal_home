import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { UserPhoto } from '@/components/ui/UserPhoto'
import { LayoutDashboard, Receipt, CalendarCheck, Home, Wallet, User, LogOut, ShieldCheck, Inbox } from 'lucide-react'
import { clsx } from 'clsx'
import { useRef, useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSession } from '@/hooks/useSession'
import { useDisplayName } from '@/hooks/useDisplayName'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Modal } from '@/components/ui/Modal'
import { logout } from '@/lib/auth'
import { ToastProvider } from '@/components/ui/Toast'
import { AppLogo } from '@/components/ui/AppLogo'
import { SideTip } from '@/components/ui/SideTip'
import { SessionClock, SESSION_STATES, sessionStateOf } from '@/components/layout/SessionClock'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { NotificationsProvider } from '@/hooks/useNotifications'
import { useAutoDebits } from '@/hooks/useAutoDebits'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { PendingMovementsPrompt } from '@/components/pending/PendingMovementsPrompt'
import { PendingMovementsLink } from '@/components/pending/PendingMovementsLink'
import { PanelCollapseToggle } from '@/components/ui/PanelCollapseToggle'
import { BalanceVisibilityToggle } from '@/components/ui/BalanceVisibilityToggle'
import { usePendingMovements } from '@/hooks/usePendingMovements'

interface NavItemDef {
  to: string
  label: string
  /** Shorter name for the narrow mobile bar. */
  shortLabel?: string
  icon: any
  end?: boolean
  /** Only in the desktop sidebar: the phone bar is already full (it has its own shortcut in the header). */
  desktopOnly?: boolean
  accent: string
  glow: string
  gradient: string
}

const BASE_NAV: NavItemDef[] = [
  {
    to: '/',
    label: 'Inicio',
    icon: LayoutDashboard,
    end: true,
    accent: '#52b69a',
    glow: 'rgba(82, 182, 154, 0.5)',
    gradient: 'linear-gradient(145deg, rgba(82, 182, 154, 0.16), rgba(16, 37, 31, 0.08))',
  },
  {
    to: '/fijos',
    label: 'Fijos',
    icon: CalendarCheck,
    accent: '#d9ed92',
    glow: 'rgba(217, 237, 146, 0.5)',
    gradient: 'linear-gradient(145deg, rgba(217, 237, 146, 0.16), rgba(54, 66, 11, 0.08))',
  },
  {
    to: '/gastos',
    label: 'Mis gastos adicionales',
    shortLabel: 'Adicionales',
    icon: Receipt,
    accent: '#34a0a4',
    glow: 'rgba(52, 160, 164, 0.5)',
    gradient: 'linear-gradient(145deg, rgba(52, 160, 164, 0.16), rgba(10, 32, 33, 0.08))',
  },
  {
    to: '/hogar',
    label: 'Hogar',
    icon: Home,
    accent: '#168aad',
    glow: 'rgba(22, 138, 173, 0.5)',
    gradient: 'linear-gradient(145deg, rgba(22, 138, 173, 0.16), rgba(4, 27, 34, 0.08))',
  },
  {
    to: '/finanzas',
    label: 'Finanzas',
    icon: Wallet,
    accent: '#76c893',
    glow: 'rgba(118, 200, 147, 0.5)',
    gradient: 'linear-gradient(145deg, rgba(118, 200, 147, 0.16), rgba(18, 45, 28, 0.08))',
  },
  {
    to: '/pendientes',
    label: 'Pendientes por confirmar',
    shortLabel: 'Pendientes',
    icon: Inbox,
    desktopOnly: true,
    accent: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.5)',
    gradient: 'linear-gradient(145deg, rgba(56, 189, 248, 0.16), rgba(8, 36, 56, 0.08))',
  },
]


function SessionTimer({ collapsed = false }: { collapsed?: boolean }) {
  const { formatted, remaining } = useSession()
  const state = sessionStateOf(remaining)
  const { color, label } = SESSION_STATES[state]

  if (collapsed) {
    return (
      <SideTip label={`${label} · ${formatted} restantes`}>
        <div className="flex justify-center" role="timer" aria-label={`${label}: ${formatted} restantes`}>
          <SessionClock remaining={remaining} size={29} />
        </div>
      </SideTip>
    )
  }

  return (
    <div
      role="timer"
      aria-label={`${label}: ${formatted} restantes`}
      className="flex items-center gap-1.5 text-xs font-mono font-semibold pl-1 pr-2.5 py-0.5 notch-sm border transition-colors"
      style={{ color, borderColor: color + '55', backgroundColor: color + '18' }}
    >
      <SessionClock remaining={remaining} size={22} />
      <span>{formatted}</span>
    </div>
  )
}

function ProfileMenu({ variant, collapsed = false }: { variant: 'sidebar' | 'mobile'; collapsed?: boolean }) {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()

  const displayName = useDisplayName()
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // on phones the menu is a sheet with its own backdrop
    if (!open || isMobile) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, isMobile])

  const avatar = <UserPhoto name={displayName} photoURL={user?.photoURL} sizeClass="w-8 h-8" />

  const menuItems = (
    <>
      {isAdmin && (
        <button
          onClick={() => { setOpen(false); navigate('/usuarios') }}
          className="w-full flex items-center gap-3 px-3.5 py-3 text-sm font-semibold text-purple-400 hover:bg-white/5 transition rounded-xl"
        >
          <ShieldCheck size={16} className="text-purple-400" /> Panel Usuarios
        </button>
      )}
      <button
        onClick={() => { setOpen(false); navigate('/perfil') }}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-sm font-medium text-[#c7ccd1] hover:bg-white/5 transition rounded-xl"
      >
        <User size={16} className="text-[#8a929a]" /> Mi Perfil
      </button>
      <button
        onClick={() => { setOpen(false); logout() }}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 transition rounded-xl"
      >
        <LogOut size={16} /> Cerrar sesión
      </button>
    </>
  )
  const sheet = open && isMobile && (
    <Modal open onClose={() => setOpen(false)} title={displayName}>
      <p className="text-xs text-[#8a929a] -mt-2 truncate">{user?.email}</p>
      <div className="space-y-1">{menuItems}</div>
    </Modal>
  )

  const dropdown = open && !isMobile && (
    <div className={clsx(
      'absolute w-52 bg-[#0a1f2f] border border-brand-500/25 rounded-2xl shadow-2xl py-1.5 z-50 scale-in backdrop-blur-md',
      variant === 'sidebar' ? 'bottom-0 left-full ml-5' : 'right-0 mt-2',
    )}>
      <div className="px-3.5 py-2 border-b border-white/10 mb-1">
        <p className="text-xs font-bold text-[#f3f5f6] truncate">{displayName}</p>
        <p className="text-[10px] text-[#8a929a] truncate mt-0.5">{user?.email}</p>
      </div>
      {isAdmin && (
        <button
          onClick={() => { setOpen(false); navigate('/usuarios') }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-purple-400 hover:text-purple-300 hover:bg-white/5 transition"
        >
          <ShieldCheck size={14} className="text-purple-400" /> Panel Usuarios
        </button>
      )}
      <button
        onClick={() => { setOpen(false); navigate('/perfil') }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-[#c7ccd1] hover:text-[#f3f5f6] hover:bg-white/5 transition"
      >
        <User size={14} className="text-[#8a929a]" /> Mi Perfil
      </button>
      <button
        onClick={() => { setOpen(false); logout() }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition"
      >
        <LogOut size={14} /> Cerrar sesión
      </button>
    </div>
  )


  if (variant === 'sidebar') {
    return (
      <div className="relative" ref={ref}>
        <SideTip label={open ? '' : displayName}>
        <button
          onClick={() => setOpen(v => !v)}
          aria-label={displayName}
          aria-haspopup="menu"
          aria-expanded={open}
          className={clsx(
            'w-full flex items-center gap-2.5 rounded-xl hover:bg-white/5 transition p-1.5',
            collapsed ? 'justify-center' : '',
          )}
        >
          {avatar}
          {!collapsed && (
            <span className="flex-1 min-w-0 text-left">
              <p className="text-xs font-semibold text-[#f3f5f6] truncate">{displayName}</p>
              <p className="text-[10px] text-[#8a929a] truncate">{user?.email}</p>
            </span>
          )}
        </button>
        </SideTip>
        {dropdown}
        {sheet}
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-full hover:ring-2 hover:ring-brand-400/50 transition p-0.5"
        title="Mi perfil"
      >
        {avatar}
      </button>
      {dropdown}
      {sheet}
    </div>
  )
}

export default function Layout() {
  const { isAdmin } = useAuth()
  const pendingCount = usePendingMovements().counts.total
  // due automatic debits are saved as soon as the person is in the app, whichever screen they land on
  useAutoDebits()
  const wideScreen = ['/', '/fijos', '/gastos', '/hogar', '/notificaciones', '/pendientes', '/perfil', '/finanzas'].includes(useLocation().pathname)
  // The sidebar is icons only: sections are named by their tooltips, and it never expands
  const collapsed = true

  const navItems: NavItemDef[] = [
    ...BASE_NAV,
    ...(isAdmin ? [{
      to: '/usuarios',
      label: 'Usuarios',
      icon: ShieldCheck,
      accent: '#1fb4e2',
      glow: 'rgba(31, 180, 226, 0.45)',
      gradient: 'linear-gradient(145deg, rgba(31, 180, 226, 0.14), rgba(4, 27, 34, 0.05))',
    }] : []),
  ]

  return (
    <ToastProvider>
    <ConfirmProvider>
    <NotificationsProvider>
      <PendingMovementsPrompt />
      <div className="h-dvh bg-[#051018] text-[#f0fae8] flex overflow-hidden">

        {/* Desktop vertical sidebar */}
        <aside className={clsx(
          'hidden md:flex md:flex-col flex-shrink-0 bg-[#0a1f2f] border-r border-brand-500/20 transition-[width] duration-200 z-20',
          collapsed ? 'w-[68px]' : 'w-56',
        )}>
          {/* Top Logo */}
          <div className={clsx(
            'flex items-center flex-shrink-0 border-b border-white/[0.08]',
            collapsed ? 'justify-center py-4' : 'justify-between px-5 py-5',
          )}>
            <div className="flex items-center gap-2.5 min-w-0">
              <AppLogo className="w-9 h-9 flex-shrink-0" />
              {!collapsed && (
                <div>
                  <span className="font-bold text-[#f3f5f6] text-sm tracking-tight block">Gastos Hogar</span>
                  <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest block">Finanzas</span>
                </div>
              )}
            </div>
          </div>

          {/* View controls: collapse the left pane / hide sensitive balances, wherever the screen has them */}
          <div className="flex w-full flex-col items-center justify-center gap-1.5 py-2.5 border-b border-white/[0.08] flex-shrink-0">
            <PanelCollapseToggle variant="sidebar" />
            <BalanceVisibilityToggle variant="sidebar" />
          </div>

          {/* Navigation Links */}
          <nav className={clsx('flex-1 overflow-y-auto flex flex-col justify-center py-4 space-y-1.5', collapsed ? 'px-2' : 'px-3')}>
            {/* Pendientes por confirmar lives next to the bell in the footer (same level), not in this list */}
            {navItems.filter((i) => i.to !== '/pendientes').map(({ to, label, icon: Icon, end, accent, glow, gradient }) => (
              <SideTip key={to} label={label}>
              <NavLink
                to={to}
                end={end}
                aria-label={label}
                style={{
                  '--nav-accent': accent,
                  '--nav-glow': glow,
                  '--nav-grad': gradient,
                } as React.CSSProperties}
                className={({ isActive }) =>
                  clsx(
                    'sidebar-nav-item flex items-center gap-3 text-sm font-medium border relative',
                    collapsed ? 'is-collapsed justify-center px-0 py-2.5 rounded-xl' : 'px-3.5 py-2.5 notch-sm',
                    isActive
                      ? 'is-active bg-brand-500/15 text-brand-400 font-bold border-l-2 !border-brand-500 glow-brand-sm'
                      : 'text-[#9aa4ac] border-transparent hover:text-[#f3f5f6]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={clsx(
                      'icon-box flex items-center justify-center transition-all',
                      collapsed && 'w-8 h-8 rounded-lg'
                    )}>
                      <Icon
                        size={18}
                        className={clsx(
                          'sidebar-icon flex-shrink-0 transition-all duration-300',
                          isActive ? 'text-brand-400' : 'text-[#8a929a]'
                        )}
                      />
                      {to === '/pendientes' && pendingCount > 0 && (
                        <span className="absolute right-0.5 top-0.5 h-4 min-w-[16px] rounded-full bg-sky-500 px-1 text-center font-mono text-[9px] font-bold leading-4 text-[#04141f] ring-2 ring-[#0a1f2f]" aria-hidden="true">
                          {pendingCount > 99 ? '99+' : pendingCount}
                        </span>
                      )}
                    </div>
                    {!collapsed && <span className="tracking-tight">{label}</span>}
                  </>
                )}
              </NavLink>
              </SideTip>
            ))}
          </nav>

          {/* Footer with Session & Profile */}
          <div className={clsx('pb-4 pt-3 border-t border-white/[0.08] space-y-2.5 flex-shrink-0', collapsed ? 'px-2' : 'px-3.5')}>
            <div className={clsx('flex items-center justify-center gap-1.5', collapsed && 'flex-col')}>
              <PendingMovementsLink variant="sidebar" />
              <NotificationBell variant="sidebar" />
            </div>
            <SessionTimer collapsed={collapsed} />
            <ProfileMenu variant="sidebar" collapsed={collapsed} />
          </div>
        </aside>

        {/* Right column: mobile header + routed content + mobile bottom nav */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden cyber-grid radial-glow relative">

          {/* Difuminado ambiental sutil con la paleta de colores */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-tropical_teal/[0.04] blur-[150px] rounded-full" />
            <div className="absolute -bottom-20 right-10 w-[500px] h-[350px] bg-baltic_blue/[0.06] blur-[150px] rounded-full" />
          </div>

          {/* Mobile top bar */}
          <header className="md:hidden bg-[#0a1f2f]/90 backdrop-blur-md border-b border-brand-500/20 px-4 py-2.5 flex items-center justify-between sticky top-0 z-30 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <AppLogo className="w-8 h-8 flex-shrink-0" />
              <span className="font-bold text-[#f3f5f6] text-sm tracking-tight">Gastos Hogar</span>
            </div>
            <div className="flex items-center gap-2">
              <SessionTimer />
              <BalanceVisibilityToggle variant="mobile" />
              <PendingMovementsLink />
              <NotificationBell variant="mobile" />
              <ProfileMenu variant="mobile" />
            </div>
          </header>

          {/* Main content viewport */}
          <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain relative z-10">
            <div className={clsx(
              'min-h-full lg:h-full w-full mx-auto px-4 py-5 pb-28 md:pb-6 slide-up',
              // the home, fixed-expenses, expenses and household screens have two panes and uses the full width
              wideScreen ? 'max-w-none' : 'max-w-[1400px]',
            )}>
              <Outlet />
            </div>
          </main>

          {/* Mobile bottom nav */}
          <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#0a1f2f]/95 backdrop-blur-md border-t border-brand-500/20 safe-area-bottom z-30 shadow-[0_-8px_30px_rgba(5,16,24,0.7)]">
            <div className="max-w-md mx-auto flex py-1">
              {navItems.filter((item) => !item.desktopOnly).map(({ to, label, shortLabel, icon: Icon, end, accent, glow, gradient }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  style={{
                    '--nav-accent': accent,
                    '--nav-glow': glow,
                    '--nav-grad': gradient,
                  } as React.CSSProperties}
                  className={({ isActive }) =>
                    clsx(
                      'sidebar-nav-item is-mobile-nav flex-1 flex flex-col items-center pt-1.5 pb-1 gap-1 text-[10px] font-semibold transition-all',
                      isActive ? 'is-active text-brand-400' : 'text-[#8a929a] hover:text-[#f3f5f6]',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className={clsx(
                        'icon-box p-1.5 transition-all flex items-center justify-center',
                        isActive ? 'notch-sm bg-brand-500/20 border border-brand-500/40 glow-brand-sm scale-110' : 'rounded-lg',
                      )}>
                        <Icon size={18} className="sidebar-icon" />
                      </div>
                      <span className="tracking-tight">{shortLabel ?? label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </NotificationsProvider>
    </ConfirmProvider>
    </ToastProvider>
  )
}
