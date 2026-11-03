import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, AtSign, LogOut, BadgeCheck, Shield, Wallet, Landmark, CalendarRange, CreditCard, Send } from 'lucide-react'
import { clsx } from 'clsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FormActions } from '@/components/ui/FormActions'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useDisplayName } from '@/hooks/useDisplayName'
import { useSalary } from '@/hooks/useSalary'
import { updateUserProfile } from '@/lib/firestore'
import { logout } from '@/lib/auth'
import { formatCOP } from '@/shared'
import { PayScheduleForm } from '@/components/profile/PayScheduleForm'
import { PayAccountForm } from '@/components/profile/PayAccountForm'
import { UserPhoto } from '@/components/ui/UserPhoto'
import { TelegramForm } from '@/components/profile/TelegramForm'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { MobileCollapse } from '@/components/ui/MobileCollapse'

const schema = z.object({
  firstName: z.string().max(40).optional(),
  lastName:  z.string().max(40).optional(),
  apodo:     z.string().max(30, 'Máx. 30 caracteres').optional(),
})
type FormData = z.infer<typeof schema>

type Tab = 'datos' | 'sueldo' | 'pagos' | 'avisos'

const TABS: { id: Tab; label: string }[] = [
  { id: 'datos',  label: 'Datos personales' },
  { id: 'sueldo', label: 'Sueldo y períodos' },
  { id: 'pagos',  label: 'Cuenta para pagos' },
  { id: 'avisos', label: 'Avisos' },
]

export default function ProfilePage() {
  const { user, profile }  = useAuth()
  const setProfile         = useAuthStore((s) => s.setProfile)
  const displayName        = useDisplayName()
  const { showToast }      = useToast()
  const navigate           = useNavigate()
  const salary             = useSalary()
  const [params]           = useSearchParams()
  const [saving, setSaving] = useState(false)
  const [tab, setTab]      = useState<Tab>((['datos', 'sueldo', 'pagos', 'avisos'] as const).find((t) => t === params.get('tab')) ?? 'datos')

  const householdId = (profile as any)?.householdId as string | undefined

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: (profile as any)?.firstName ?? '',
      lastName:  (profile as any)?.lastName  ?? '',
      apodo:     (profile as any)?.apodo     ?? '',
    },
  })

  async function onSave(data: FormData) {
    if (!user) return
    setSaving(true)
    try {
      const patch = {
        firstName: data.firstName?.trim() ?? '',
        lastName:  data.lastName?.trim()  ?? '',
        apodo:     data.apodo?.trim()     ?? '',
      }
      await updateUserProfile(user.uid, patch, householdId)
      setProfile({ ...profile, ...patch } as any)
      showToast('Perfil actualizado', 'edit')
    } catch { showToast('Error al guardar', 'error') }
    finally { setSaving(false) }
  }

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const initials = displayName.slice(0, 2).toUpperCase()

  // What the user has configured, one line each: the left pane summarises it and a tap opens that tab
  const rules = salary.schedule?.rules ?? []
  const accountName = (id?: string) => (id ? (salary.accounts.find((a: any) => a.id === id)?.name as string | undefined) : undefined)
  const salaryText = rules.length === 0
    ? 'Sin configurar'
    : rules.length === 1
      ? `${formatCOP(rules[0].amount)} · ${rules[0].kind === 'day' ? `día ${rules[0].day}` : 'último día hábil'}`
      : `${rules.length} pagos al mes · ${formatCOP(rules.reduce((sum, r) => sum + r.amount, 0))}`
  const summary: { icon: typeof Wallet; label: string; value: string; to: Tab }[] = [
    { icon: Wallet, label: 'Sueldo', value: salaryText, to: 'sueldo' },
    { icon: CalendarRange, label: 'Períodos', value: salary.periodMode === 'calendar' ? 'Por mes calendario' : 'Por fecha de pago', to: 'sueldo' },
    { icon: Landmark, label: 'Cuenta del sueldo', value: accountName(salary.depositAccountId) ?? 'Ninguna', to: 'sueldo' },
    { icon: CreditCard, label: 'Cuenta para pagos', value: accountName((profile as any)?.payAccountId) ?? 'La del último pago', to: 'pagos' },
    { icon: Send, label: 'Avisos por Telegram', value: (profile as any)?.telegramChatId ? 'Vinculado' : 'Sin vincular', to: 'avisos' },
  ]

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      {/* Left pane: who you are, what you have set up and the session. Fixed on wide screens, stacked on phones. */}
      <CurvedScrollContainer
        className="lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50"
        contentClassName="max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6"
        corners="both"
        borderRadius={24}
        offset={7}
        variant="plain"
        themeColor="brand"
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <Shield size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Identidad</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f0fae8]">Mi Perfil</h1>
        </div>

        {/* Avatar + name card */}
        <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-4 sm:p-5 flex items-center gap-4 glow-brand-sm shadow-xl">
          <UserPhoto name={displayName} photoURL={user?.photoURL} sizeClass="w-14 h-14" textClass="text-lg" />
          <div className="min-w-0">
            <p className="text-base font-bold text-[#f0fae8] truncate">{displayName}</p>
            {((profile as any)?.firstName || (profile as any)?.lastName) && (
              <p className="text-xs text-[#9aa4ac] truncate mt-0.5">
                {[(profile as any)?.firstName, (profile as any)?.lastName].filter(Boolean).join(' ')}
              </p>
            )}
            <p className="text-xs text-[#5f6a72] truncate font-mono mt-0.5">{user?.email}</p>
          </div>
        </div>

        <MobileCollapse title="Mi configuración" hint="Sueldo, períodos y cuentas">
          <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
            <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Tu configuración</p>
            <div className="space-y-1">
              {summary.map(({ icon: Icon, label, value, to }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setTab(to)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/5 transition"
                >
                  <span className="flex items-center gap-2 text-xs text-[#9aa4ac] flex-shrink-0">
                    <Icon size={14} className="text-brand-400" aria-hidden="true" /> {label}
                  </span>
                  <span className="text-xs font-mono font-semibold text-[#f0fae8] truncate text-right">{value}</span>
                </button>
              ))}
            </div>
          </div>
        </MobileCollapse>

        {/* Session */}
        <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-4 sm:p-5 space-y-3 shadow-xl">
          <p className="font-pixel text-[10px] text-red-400 uppercase tracking-widest font-bold">Sesión</p>
          <button
            onClick={handleLogout}
            className="rounded-xl w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/20 hover:text-red-300 transition interactive-press"
          >
            <LogOut size={14} /> Cerrar sesión en este dispositivo
          </button>
        </div>
      </CurvedScrollContainer>

      {/* Right pane: the view tabs stay on top and only the content below scrolls (the same frame as Gastos Fijos) */}
      <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
        <div className="flex justify-center sm:justify-start flex-shrink-0">
          <div className="flex gap-1 p-1 bg-[#0d263a] border border-white/[0.06] rounded-xl text-xs overflow-x-auto scrollbar-none max-w-full">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  'whitespace-nowrap px-4 py-2 rounded-lg font-medium transition',
                  tab === t.id ? 'bg-[#0a1f2f] text-white font-semibold border border-white/10 hover:border-brand-400/60 hover:bg-brand-500/10' : 'text-[#8a929a] hover:text-white',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <CurvedScrollContainer
          className="lg:flex-1 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50"
          contentClassName="max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6"
          corners="bottom-right"
          borderRadius={24}
          offset={7}
          variant="plain"
          themeColor="brand"
        >
          {tab === 'datos' && (
            <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-4 shadow-xl">
              <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Editar Datos</p>

              <form onSubmit={handleSubmit(onSave)} className="space-y-4">
                {/* Read-only fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#8a929a] flex items-center gap-1.5">
                      <User size={12} /> Nombre de Google
                    </label>
                    <div className="border border-white/10 rounded-xl px-3 py-2 text-sm text-[#8a929a] bg-[#0d263a] select-none font-mono truncate">
                      {user?.displayName ?? '—'}
                    </div>
                    <p className="text-[10px] text-[#5f6a72]">Proveniente de tu cuenta autenticada</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#8a929a] flex items-center gap-1.5">
                      <Mail size={12} /> Correo Electrónico
                    </label>
                    <div className="border border-white/10 rounded-xl px-3 py-2 text-sm text-[#8a929a] bg-[#0d263a] select-none font-mono truncate">
                      {user?.email ?? '—'}
                    </div>
                  </div>
                </div>

                {/* Editable */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#c7ccd1] flex items-center gap-1.5">
                      <BadgeCheck size={12} /> Primer nombre
                    </label>
                    <Input placeholder={user?.displayName?.split(' ')[0] ?? ''} {...register('firstName')} error={errors.firstName?.message} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#c7ccd1] flex items-center gap-1.5">
                      <BadgeCheck size={12} /> Primer apellido
                    </label>
                    <Input placeholder={user?.displayName?.split(' ')[1] ?? ''} {...register('lastName')} error={errors.lastName?.message} />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#c7ccd1] flex items-center gap-1.5">
                    <AtSign size={12} /> Apodo preferido
                  </label>
                  <Input
                    placeholder={(profile as any)?.firstName || user?.displayName?.split(' ')[0] || 'Tu apodo'}
                    {...register('apodo')}
                    error={errors.apodo?.message}
                  />
                  <p className="text-[10px] text-[#8a929a]">Se muestra en todos los balances y tarjetas del hogar.</p>
                </div>

                <FormActions
                  submit
                  saving={saving}
                  disabled={!isDirty}
                  saveLabel="Guardar datos personales"
                  onCancel={() => reset({
                    firstName: (profile as any)?.firstName ?? '',
                    lastName:  (profile as any)?.lastName  ?? '',
                    apodo:     (profile as any)?.apodo     ?? '',
                  })}
                />
              </form>
            </div>
          )}

          {tab === 'sueldo' && <PayScheduleForm />}
          {tab === 'pagos' && <PayAccountForm />}
          {tab === 'avisos' && <TelegramForm />}
        </CurvedScrollContainer>
      </div>
    </div>
  )
}
