import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, AtSign, LogOut, BadgeCheck } from 'lucide-react'
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
      showToast('Perfil actualizado', 'success')
    } catch { showToast('Error al guardar', 'error') }
    finally { setSaving(false) }
  }

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div className="space-y-5 fade-in max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-bold text-[#0f172a]">Mi perfil</h1>
        <p className="text-sm text-[#64748b]">Información de tu cuenta</p>
      </div>

      {/* Avatar + name */}
      <Card className="flex items-center gap-4 p-5">
        {user?.photoURL ? (
          <img
            src={user.photoURL}
            alt={displayName}
            className="w-16 h-16 rounded-full ring-2 ring-brand-100 flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xl font-bold flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-base font-bold text-gray-900 truncate">{displayName}</p>
          {((profile as any)?.firstName || (profile as any)?.lastName) && (
            <p className="text-xs text-gray-500 truncate">
              {[(profile as any)?.firstName, (profile as any)?.lastName].filter(Boolean).join(' ')}
            </p>
          )}
          <p className="text-xs text-gray-400 truncate">{user?.email}</p>
        </div>
      </Card>

      {/* Edit form */}
      <Card className="p-5 space-y-4">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">Editar datos</p>

        <form onSubmit={handleSubmit(onSave)} className="space-y-4">
          {/* Read-only fields */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
              <User size={12} /> Nombre completo
            </label>
            <div className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-400 bg-gray-50 select-none">
              {user?.displayName ?? '—'}
            </div>
            <p className="text-[10px] text-gray-400">Viene de tu cuenta de Google</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
              <Mail size={12} /> Correo
            </label>
            <div className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-400 bg-gray-50 select-none">
              {user?.email ?? '—'}
            </div>
          </div>

          {/* Editable */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <BadgeCheck size={12} /> Primer nombre
              </label>
              <Input
                placeholder={user?.displayName?.split(' ')[0] ?? ''}
                {...register('firstName')}
                error={errors.firstName?.message}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
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
            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <AtSign size={12} /> Apodo
            </label>
            <Input
              placeholder={(profile as any)?.firstName || user?.displayName?.split(' ')[0] || 'Tu apodo'}
              {...register('apodo')}
              error={errors.apodo?.message}
            />
            <p className="text-[10px] text-gray-400">
              Si lo dejas vacío se usa el primer nombre. Se muestra en todo el app.
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={saving || !isDirty}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </form>
      </Card>

      {/* Danger zone */}
      <Card className="p-5 space-y-3">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">Sesión</p>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition"
        >
          <LogOut size={15} /> Cerrar sesión
        </button>
      </Card>
    </div>
  )
}
