import { useEffect, useState } from 'react'
import { Landmark } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { FormActions } from '@/components/ui/FormActions'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { getAccounts, updateUserProfile } from '@/lib/firestore'
import { formatCOP } from '@/shared'

const selectCls = 'w-full bg-[#0d263a] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-[#f3f5f6] outline-none focus:border-brand-400 transition'

/** The account offered first whenever a payment is made; it can still be changed at that moment. */
export function PayAccountForm() {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const { showToast } = useToast()
  const [accounts, setAccounts] = useState<any[]>([])
  const saved = ((profile as any)?.payAccountId ?? '') as string
  const [value, setValue] = useState(saved)
  const [saving, setSaving] = useState(false)

  // the profile may load after the form is drawn: show the account that is really saved
  useEffect(() => { setValue(saved) }, [saved])

  useEffect(() => {
    if (!user) return
    getAccounts(user.uid).then((a) => setAccounts(a as any[])).catch(() => {})
  }, [user])

  async function onSave() {
    if (!user) return
    setSaving(true)
    try {
      await updateUserProfile(user.uid, { payAccountId: value })
      setProfile({ ...profile, payAccountId: value } as any)
      showToast('Cuenta para pagos guardada', 'success')
    } catch {
      showToast('No se pudo guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-3 shadow-xl">
      <div className="flex items-center gap-2">
        <Landmark size={14} className="text-brand-400" />
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Cuenta para pagos</p>
      </div>
      {accounts.length === 0 ? (
        <p className="text-xs text-[#8a929a]">Aún no tienes cuentas. Se crean en Finanzas (la "Cuenta default" aparece sola al abrir Inicio o Fijos).</p>
      ) : (
        <label className="space-y-1 block">
          <span className="text-xs font-semibold text-[#9aa4ac]">¿De qué cuenta salen tus pagos normalmente?</span>
          <select className={selectCls} value={value} disabled={saving} onChange={(e) => setValue(e.target.value)}>
            <option value="">Ninguna en particular (se usa la del último pago)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatCOP(a.balance as number)}</option>)}
          </select>
          <span className="text-[11px] text-[#8a929a] block">Es la que aparece elegida al pagar o registrar un gasto; en cada pago puedes cambiarla. Si un gasto tiene su propia cuenta configurada, esa tiene prioridad.</span>
        </label>
      )}
      {accounts.length > 0 && (
        <FormActions onSave={onSave} onCancel={() => setValue(saved)} saving={saving} disabled={value === saved} saveLabel="Guardar cuenta para pagos" />
      )}
    </div>
  )
}
