import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Receipt, CalendarCheck, Home, Wallet, Timer, User, LogOut, ChevronLeft } from 'lucide-react'
import { clsx } from 'clsx'
import { useRef, useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSession } from '@/hooks/useSession'
import { useDisplayName } from '@/hooks/useDisplayName'
import { logout } from '@/lib/auth'
import { ToastProvider } from '@/components/ui/Toast'

const NAV = [
  { to: '/',         label: 'Inicio',   icon: LayoutDashboard, end: true },
  { to: '/gastos',   label: 'Gastos',   icon: Receipt },
  { to: '/fijos',    label: 'Fijos',    icon: CalendarCheck },
  { to: '/hogar',    label: 'Hogar',    icon: Home },
  { to: '/finanzas', label: 'Finanzas', icon: Wallet },
]

function SessionTimer({ collapsed = false }: { collapsed?: boolean }) {
  const { formatted, isWarning } = useSession()

  if (collapsed) {
    return (
      <div
        title={formatted}
        className={clsx(
          'flex items-center justify-center w-8 h-8 mx-auto rounded-full transition-colors',
          isWarning ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-gray-100 text-gray-500',
        )}
      >
        <Timer size={13} />
      </div>
    )
  }

  return (
    <div className={clsx(
      'flex items-center gap-1 text-xs font-mono font-semibold px-2.5 py-1 rounded-full transition-colors',
      isWarning
        ? 'bg-red-50 text-red-600 animate-pulse'
        : 'bg-gray-100 text-gray-500',
    )}>
      <Timer size={12} />
      {formatted}
    </div>
  )
}

// ── Avatar + dropdown, reused in the desktop sidebar footer and the mobile top bar ──
function ProfileMenu({ variant, collapsed = false }: { variant: 'sidebar' | 'mobile'; collapsed?: boolean }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const displayName = useDisplayName()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const avatar = user?.photoURL ? (
    <img src={user.photoURL} alt={displayName} className="w-8 h-8 rounded-full ring-2 ring-brand-100 flex-shrink-0" />
  ) : (
    <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">
      {displayName.slice(0, 2).toUpperCase()}
    </div>
  )

  const dropdown = open && (
    <div className={clsx(
      'absolute w-48 bg-white rounded-2xl shadow-lg border border-gray-100 py-1.5 z-50',
      variant === 'sidebar' ? 'bottom-full left-0 mb-2' : 'right-0 mt-2',
    )}>
      <div className="px-3 py-1.5 border-b border-gray-100 mb-1">
        <p className="text-xs font-semibold text-gray-800 truncate">{displayName}</p>
        <p className="text-[10px] text-gray-400 truncate">{user?.email}</p>
      </div>
      <button
        onClick={() => { setOpen(false); navigate('/perfil') }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
      >
        <User size={14} className="text-gray-400" /> Perfil
      </button>
      <button
        onClick={() => { setOpen(false); logout() }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
      >
        <LogOut size={14} /> Cerrar sesión
      </button>
    </div>
  )

  if (variant === 'sidebar') {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(v => !v)}
          title={collapsed ? displayName : undefined}
          className={clsx(
            'w-full flex items-center gap-2.5 rounded-xl hover:bg-gray-100 transition',
            collapsed ? 'justify-center px-0 py-2' : 'px-2 py-2',
          )}
        >
          {avatar}
          {!collapsed && (
            <span className="flex-1 min-w-0 text-left">
              <p className="text-xs font-semibold text-gray-800 truncate">{displayName}</p>
              <p className="text-[10px] text-gray-400 truncate">{user?.email}</p>
            </span>
          )}
        </button>
        {dropdown}
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-full hover:ring-2 hover:ring-brand-200 transition"
        title="Mi perfil"
      >
        {avatar}
      </button>
      {dropdown}
    </div>
  )
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0') } catch { /* noop */ }
  }, [collapsed])

  return (
    <ToastProvider>
      <div className="h-screen bg-[#f8fafc] flex overflow-hidden">

        {/* Desktop vertical sidebar */}
        <aside className={clsx(
          'hidden md:flex md:flex-col flex-shrink-0 bg-white border-r border-gray-100 transition-[width] duration-200',
          collapsed ? 'w-[68px]' : 'w-56',
        )}>
          <div className={clsx(
            'flex items-center flex-shrink-0 border-b border-gray-100',
            collapsed ? 'justify-center py-4' : 'justify-between px-5 py-5',
          )}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl flex-shrink-0">🏠</span>
              {!collapsed && <span className="font-bold text-gray-900 text-sm truncate">Gastos Hogar</span>}
            </div>
            {!collapsed && (
              <button
                onClick={() => setCollapsed(true)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition flex-shrink-0"
                title="Colapsar menú"
              >
                <ChevronLeft size={16} />
              </button>
            )}
          </div>

          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="mx-auto mt-2.5 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition flex-shrink-0"
              title="Expandir menú"
            >
              <ChevronLeft size={16} className="rotate-180" />
            </button>
          )}

          <nav className={clsx('flex-1 overflow-y-auto py-4 space-y-1', collapsed ? 'px-2' : 'px-3')}>
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-xl text-sm font-medium transition-colors',
                    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5',
                    isActive ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                  )
                }
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && label}
              </NavLink>
            ))}
          </nav>

          <div className={clsx('pb-3 pt-2 border-t border-gray-100 space-y-2 flex-shrink-0', collapsed ? 'px-2' : 'px-3')}>
            <SessionTimer collapsed={collapsed} />
            <ProfileMenu variant="sidebar" collapsed={collapsed} />
          </div>
        </aside>

        {/* Right column: mobile header + routed content + mobile bottom nav */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Mobile top bar (hidden on desktop — sidebar replaces it) */}
          <header className="md:hidden bg-white border-b border-gray-100 px-4 py-2.5 flex items-center justify-between sticky top-0 z-30 shadow-sm flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">🏠</span>
              <span className="font-bold text-gray-900 text-sm">Gastos Hogar</span>
            </div>
            <div className="flex items-center gap-2">
              <SessionTimer />
              <ProfileMenu variant="mobile" />
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-y-auto">
            <div className="h-full max-w-[1400px] w-full mx-auto px-4 py-5 pb-28 md:pb-5 slide-up">
              <Outlet />
            </div>
          </main>

          {/* Mobile bottom nav (hidden on desktop — sidebar replaces it) */}
          <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 safe-area-bottom z-30 shadow-[0_-1px_3px_rgba(0,0,0,0.05)]">
            <div className="max-w-2xl mx-auto flex">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    clsx(
                      'flex-1 flex flex-col items-center pt-2 pb-1 gap-0.5 text-[10px] font-medium transition-colors',
                      isActive ? 'text-brand-600' : 'text-gray-400 hover:text-gray-500',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className={clsx(
                        'p-1.5 rounded-xl transition-all',
                        isActive && 'bg-brand-50 scale-110',
                      )}>
                        <Icon size={19} />
                      </div>
                      <span>{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </ToastProvider>
  )
}
