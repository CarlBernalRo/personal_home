import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, AtSign, LogOut, BadgeCheck, Shield } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useDisplayName } from '@/hooks/useDisplayName'
import { updateUserProfile } from '@/lib/firestore'
import { logout } from '@/lib/auth'
import { PayScheduleForm } from '@/components/profile/PayScheduleForm'
import { PayAccountForm } from '@/components/profile/PayAccountForm'

const schema = z.object({
  firstName: z.string().max(40).optional(),
  lastName:  z.string().max(40).optional(),
  apodo:     z.string().max(30, 'Máx. 30 caracteres').optional(),
})
type FormData = z.infer<typeof schema>

export default function ProfilePage() {
  const { user, profile }  = useAuth()
  const setProfile         = useAuthStore((s) => s.setProfile)
  const displayName        = useDisplayName()
  const { showToast }      = useToast()
  const navigate           = useNavigate()
  const [saving, setSaving] = useState(false)

  const householdId = (profile as any)?.householdId as string | undefined

  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<FormData>({
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

  return (
    <div className="space-y-5 fade-in max-w-lg mx-auto text-[#f3f5f6]">
      <div>
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
          <Shield size={11} className="text-brand-400" />
          <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Identidad</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#f0fae8]">Mi Perfil</h1>
        <p className="text-xs text-[#9aa4ac]">Administra tu información y nombre visible</p>
      </div>

      {/* Avatar + name card */}
      <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 flex items-center gap-4 glow-brand-sm shadow-xl">
        {user?.photoURL ? (
          <img
            src={user.photoURL}
            alt={displayName}
            className="w-16 h-16 rounded-full ring-2 ring-brand-500/40 flex-shrink-0 object-cover"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-brand-500/20 border border-brand-500/40 flex items-center justify-center text-brand-400 text-xl font-bold flex-shrink-0">
            {initials}
          </div>
        )}
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

      {/* Edit form */}
      <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-4 shadow-xl">
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Editar Datos</p>

        <form onSubmit={handleSubmit(onSave)} className="space-y-4">
          {/* Read-only fields */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[#8a929a] flex items-center gap-1.5">
              <User size={12} /> Nombre de Google
            </label>
            <div className="border border-white/10 rounded-xl px-3 py-2 text-sm text-[#8a929a] bg-[#0d263a] select-none font-mono">
              {user?.displayName ?? '—'}
            </div>
            <p className="text-[10px] text-[#5f6a72]">Proveniente de tu cuenta autenticada</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-[#8a929a] flex items-center gap-1.5">
              <Mail size={12} /> Correo Electrónico
            </label>
            <div className="border border-white/10 rounded-xl px-3 py-2 text-sm text-[#8a929a] bg-[#0d263a] select-none font-mono">
              {user?.email ?? '—'}
            </div>
          </div>

          {/* Editable */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#c7ccd1] flex items-center gap-1.5">
                <BadgeCheck size={12} /> Primer nombre
              </label>
              <Input
                placeholder={user?.displayName?.split(' ')[0] ?? ''}
                {...register('firstName')}
                error={errors.firstName?.message}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#c7ccd1] flex items-center gap-1.5">
                <BadgeCheck size={12} /> Primer apellido
              </label>
              <Input
                placeholder={user?.displayName?.split(' ')[1] ?? ''}
                {...register('lastName')}
                error={errors.lastName?.message}
              />
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
            <p className="text-[10px] text-[#8a929a]">
              Se muestra en todos los balances y tarjetas del hogar.
            </p>
          </div>

          <Button type="submit" className="w-full mt-2" disabled={saving || !isDirty} notched={false}>
            {saving ? 'Guardando…' : 'Guardar Cambios'}
          </Button>
        </form>
      </div>

      <PayScheduleForm />

      <PayAccountForm />

      {/* Danger zone / Logout */}
      <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 space-y-3 shadow-xl">
        <p className="font-pixel text-[10px] text-red-400 uppercase tracking-widest font-bold">Sesión</p>
        <button
          onClick={handleLogout}
          className="rounded-xl w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/20 hover:text-red-300 transition interactive-press"
        >
          <LogOut size={14} /> Cerrar sesión en este dispositivo
        </button>
      </div>
    </div>
  )
}
