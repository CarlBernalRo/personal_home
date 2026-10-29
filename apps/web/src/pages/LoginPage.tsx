import { useState } from 'react'
import { signInWithGoogle } from '@/lib/auth'
import { useAuth } from '@/hooks/useAuth'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const { authError, setAuthError } = useAuth()

  async function handleLogin() {
    setLoading(true)
    setAuthError(null)
    try {
      await signInWithGoogle()
    } catch {
      // popup closed by user — no error needed
    } finally {
      setLoading(false)
    }
  }

  const error = authError ?? ''

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-emerald-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm fade-in">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 flex flex-col items-center gap-6">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center text-4xl shadow-sm">
              🏠
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900">Gastos Hogar</h1>
              <p className="text-sm text-gray-500 mt-1">
                Administra tus gastos en un solo lugar
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="w-full space-y-2.5 text-sm text-gray-600">
            {[
              { icon: '📊', text: 'Gastos personales fijos y variables' },
              { icon: '🏠', text: 'Deudas y abonos del hogar' },
              { icon: '💳', text: 'Cuentas, ingresos y saldos' },
              { icon: '🐷', text: 'Metas de ahorro' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                <span className="text-lg w-7 text-center">{icon}</span>
                <span className="text-xs">{text}</span>
              </div>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="w-full flex items-start gap-2.5 text-sm text-red-600 bg-red-50 rounded-xl p-3 border border-red-100">
              <span className="text-base mt-0.5">⚠️</span>
              <p>{error}</p>
            </div>
          )}

          {/* Google button */}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 rounded-2xl px-4 py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-gray-300 border-t-brand-600 rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            {loading ? 'Iniciando sesión…' : 'Continuar con Google'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Solo cuentas autorizadas pueden acceder
          </p>
        </div>
      </div>
    </div>
  )
}
