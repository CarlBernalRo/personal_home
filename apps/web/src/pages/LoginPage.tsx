import { AppLogo } from '@/components/ui/AppLogo'
import { useState } from 'react'
import { signInWithGoogle, signInAdmin } from '@/lib/auth'
import { useAuth } from '@/hooks/useAuth'
import { Shield, User, Eye, EyeOff, Lock, ExternalLink, TriangleAlert } from 'lucide-react'
import { clsx } from 'clsx'

export default function LoginPage() {
  const [mode, setMode] = useState<'user' | 'admin'>('user')
  const [loading, setLoading] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { authError, setAuthError } = useAuth()
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleGoogleLogin() {
    setLoading(true)
    setAuthError(null)
    setLocalError(null)
    try {
      await signInWithGoogle()
    } catch {
      // User closed popup
    } finally {
      setLoading(false)
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!adminEmail.trim() || !adminPassword) {
      setLocalError('Por favor ingresa tu usuario y contraseña')
      return
    }

    setLoading(true)
    setAuthError(null)
    setLocalError(null)

    try {
      await signInAdmin(adminEmail, adminPassword)
    } catch (err: any) {
      const code = err?.code
      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
        setLocalError('Usuario o contraseña de administrador incorrectos')
      } else if (code === 'auth/operation-not-allowed') {
        setLocalError('El método de inicio de sesión con Correo/Contraseña está desactivado en Firebase. Debes habilitarlo en Firebase Console > Authentication > Métodos de inicio de sesión (Sign-in method).')
      } else {
        setLocalError(err?.message || 'Error al autenticar administrador')
      }
    } finally {
      setLoading(false)
    }
  }

  const activeError = localError || authError

  return (
    <div className="min-h-screen bg-[#051018] flex items-center justify-center p-4 sm:p-6 text-[#f0fae8] relative overflow-hidden cyber-grid radial-glow">
      {/* Difuminado ambiental sutil con la paleta de colores */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[350px] bg-tropical_teal/[0.05] blur-[150px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-20 right-1/4 w-[500px] h-[350px] bg-baltic_blue/[0.07] blur-[150px] rounded-full pointer-events-none" />

      <div className="w-full max-w-[420px] z-10 fade-in">
        {/* Main Card */}
        <div className="bg-[#0a1f2f] border border-brand-500/25 notch shadow-2xl p-7 sm:p-8 space-y-6">

          {/* Header Brand */}
          <div className="text-center space-y-2">
            <AppLogo className="w-14 h-14 mx-auto" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[#f3f5f6]">
                Gastos Hogar
              </h1>
              <p className="text-xs text-[#8a929a] mt-0.5">
                Plataforma de finanzas personales y compartidas
              </p>
            </div>
          </div>

          {/* Interactive Mode Switcher (Sober Segmented Control) */}
          <div className="bg-[#0d263a] p-1 rounded-xl flex border border-white/[0.06] text-xs">
            <button
              type="button"
              onClick={() => {
                setMode('user')
                setLocalError(null)
                setAuthError(null)
              }}
              className={clsx(
                'flex-1 py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2',
                mode === 'user'
                  ? 'bg-[#0a1f2f] text-[#f3f5f6] shadow-sm font-semibold border border-white/10'
                  : 'text-[#8a929a] hover:text-[#f3f5f6]',
              )}
            >
              <User size={13} className={mode === 'user' ? 'text-brand-400' : ''} />
              <span>Integrante</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('admin')
                setLocalError(null)
                setAuthError(null)
              }}
              className={clsx(
                'flex-1 py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2',
                mode === 'admin'
                  ? 'bg-[#0a1f2f] text-[#f3f5f6] shadow-sm font-semibold border border-white/10'
                  : 'text-[#8a929a] hover:text-[#f3f5f6]',
              )}
            >
              <Shield size={13} className={mode === 'admin' ? 'text-purple-400' : ''} />
              <span>Administrador</span>
            </button>
          </div>

          {/* Alerts */}
          {activeError && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex flex-col gap-2.5">
              <div className="flex items-start gap-2.5">
                <TriangleAlert size={15} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                <p className="leading-relaxed">{activeError}</p>
              </div>
              {activeError.includes('Firebase Console') && (
                <a
                  href="https://console.firebase.google.com/project/personalhome-3ee06/authentication/providers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/35 text-red-200 border border-red-500/30 font-semibold text-[11px] transition active:scale-95"
                >
                  <span>Abrir Firebase Console aquí</span>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}

          {/* ── MODE 1: INTEGRANTE (GOOGLE AUTH) ── */}
          {mode === 'user' && (
            <div className="space-y-4 fade-in">
              <p className="text-xs text-[#8a929a] text-center leading-relaxed">
                Acceso para integrantes autorizados de la familia a través de cuenta Google.
              </p>

              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  title="Iniciar sesión con Google"
                  aria-label="Iniciar sesión con Google"
                  style={{ backgroundColor: '#ffffff' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f1f5f9'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffffff'
                  }}
                  className="w-12 h-12 flex items-center justify-center rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg border border-white/20"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-6 h-6 flex-shrink-0" fill="none">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── MODE 2: ADMINISTRADOR (EMAIL & PASSWORD) ── */}
          {mode === 'admin' && (
            <form onSubmit={handleAdminLogin} className="space-y-4 fade-in">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#8a929a] block">
                    Usuario
                  </label>
                  <input
                    type="text"
                    autoComplete="username"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin"
                    required
                    className="w-full bg-[#0d263a] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none focus:border-purple-400 transition"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#8a929a] block">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      className="w-full bg-[#0d263a] border border-white/10 rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none focus:border-purple-400 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a929a] hover:text-[#f3f5f6] transition p-1"
                      title={showPassword ? 'Ocultar' : 'Mostrar'}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Lock size={15} />
                    <span>Ingresar como Administrador</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
