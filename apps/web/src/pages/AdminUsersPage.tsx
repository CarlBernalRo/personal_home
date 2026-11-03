import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Users, UserPlus, Shield, ShieldCheck, Search, Trash2, Check, X, Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { getAllowedUsers, createAllowedUser, updateAllowedUser } from '@/lib/firestore'
import { PERMISSIONS, type AllowedUser } from '@/shared'
import { clsx } from 'clsx'

const userSchema = z.object({
  email: z.string().email('Correo electrónico inválido'),
  name:  z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  role:  z.enum(['integrante', 'admin', 'user']),
})

type UserFormData = z.infer<typeof userSchema>

const DEFAULT_PERMISSIONS = ['view_households', 'manage_expenses', 'manage_debts', 'view_finances']

export default function AdminUsersPage() {
  const { user }      = useAuth()
  const { showToast } = useToast()
  const ask = useConfirm()

  const [users, setUsers]             = useState<AllowedUser[]>([])
  const [loading, setLoading]         = useState(true)
  const [openModal, setOpenModal]     = useState(false)
  const [saving, setSaving]           = useState(false)
  const [search, setSearch]           = useState('')
  const [editing, setEditing]         = useState<AllowedUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [showDeleted, setShowDeleted] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: { role: 'integrante' },
  })

  async function load() {
    try {
      setLoading(true)
      const data = await getAllowedUsers()
      setUsers(data as unknown as AllowedUser[])
    } catch {
      showToast('Error al cargar la lista de usuarios', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function openCreate() {
    setEditing(null)
    setPermissions(DEFAULT_PERMISSIONS)
    reset({ name: '', email: '', role: 'integrante' })
    setOpenModal(true)
  }

  function openEdit(u: AllowedUser) {
    setEditing(u)
    setPermissions(u.permissions ?? [])
    reset({ name: u.name, email: u.email, role: (u.role ?? 'integrante') as UserFormData['role'] })
    setOpenModal(true)
  }

  function togglePermission(key: string) {
    setPermissions(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  async function onSubmit(data: UserFormData) {
    setSaving(true)
    try {
      if (editing) {
        await updateAllowedUser(editing.id, {
          name: data.name.trim(),
          email: data.email,
          role: data.role,
          permissions,
        })
        showToast(`Usuario "${data.name}" actualizado`, 'edit')
      } else {
        await createAllowedUser({
          email: data.email,
          name: data.name,
          role: data.role,
          active: true,
          permissions,
        })
        showToast(`Usuario "${data.name}" autorizado con éxito`, 'success')
      }
      setOpenModal(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al guardar usuario', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(u: AllowedUser) {
    try {
      await updateAllowedUser(u.id, { active: !u.active })
      setUsers(prev => prev.map(item => item.id === u.id ? { ...item, active: !item.active } : item))
      showToast(`Estado de ${u.name} actualizado`, 'edit')
    } catch {
      showToast('Error al actualizar estado del usuario', 'error')
    }
  }

  // Soft delete: access is revoked (active=false) but the record is kept and restorable.
  async function handleDelete(u: AllowedUser) {
    if (!(await ask(`¿Eliminar a "${u.name}" (${u.email})? Perderá el acceso y podrás restaurarlo después.`, { title: 'Eliminar usuario' }))) return
    try {
      await updateAllowedUser(u.id, { deleted: true, active: false })
      setUsers(prev => prev.map(item => item.id === u.id ? { ...item, deleted: true, active: false } : item))
      showToast('Usuario eliminado', 'delete')
    } catch {
      showToast('Error al eliminar usuario', 'error')
    }
  }

  async function handleRestore(u: AllowedUser) {
    try {
      await updateAllowedUser(u.id, { deleted: false, active: true })
      setUsers(prev => prev.map(item => item.id === u.id ? { ...item, deleted: false, active: true } : item))
      showToast('Usuario restaurado', 'success')
    } catch {
      showToast('Error al restaurar usuario', 'error')
    }
  }

  const filtered = users.filter((u) => {
    if (!showDeleted && u.deleted) return false
    const q = search.toLowerCase()
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
  })

  const visible     = users.filter(u => !u.deleted)
  const adminCount  = visible.filter(u => u.role === 'admin').length
  const activeCount = visible.filter(u => u.active).length

  return (
    <div className="space-y-6 fade-in max-w-4xl mx-auto text-[#f3f5f6]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-white/[0.08]">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-semibold">
            <ShieldCheck size={12} />
            <span>Panel de Administración</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f3f5f6]">
            Gestión de Usuarios Autorizados
          </h1>
          <p className="text-xs text-[#9aa4ac] mt-0.5">
            El registro público está cerrado. Solo los integrantes (Google) listados aquí pueden acceder al sistema.
          </p>
        </div>

        <Button onClick={openCreate} size="sm" notched={true}>
          <UserPlus size={15} /> Autorizar nuevo usuario
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3.5 bg-[#0a1f2f] border border-white/[0.08] notch-sm">
          <p className="text-[11px] font-medium text-[#75c5ae]">Total Autorizados</p>
          <p className="text-xl font-bold text-white font-mono mt-0.5">{visible.length}</p>
        </div>
        <div className="p-3.5 bg-[#0a1f2f] border border-white/[0.08] notch-sm">
          <p className="text-[11px] font-medium text-[#75c5ae]">Activos</p>
          <p className="text-xl font-bold text-ocean_mist font-mono mt-0.5">{activeCount}</p>
        </div>
        <div className="p-3.5 bg-[#0a1f2f] border border-white/[0.08] notch-sm">
          <p className="text-[11px] font-medium text-[#75c5ae]">Administradores</p>
          <p className="text-xl font-bold text-bondi_blue font-mono mt-0.5">{adminCount}</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#75c5ae]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar usuario por nombre o correo electrónico…"
          className="w-full bg-[#0a1f2f] border border-brand-500/20 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-[#75c5ae]/60 outline-none focus:border-tropical_teal focus:ring-2 focus:ring-tropical_teal/20 transition"
        />
      </div>

      <label className="flex items-center gap-2 text-[11px] text-[#8a929a] cursor-pointer select-none w-fit">
        <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
        <span>Mostrar eliminados</span>
      </label>

      {/* Users List */}
      {loading ? (
        <SkeletonList count={4} />
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center bg-[#0a1f2f] border border-white/[0.08] notch space-y-2">
          <Users size={36} className="mx-auto text-[#75c5ae]" />
          <p className="text-sm font-semibold text-white">No se encontraron usuarios</p>
          <p className="text-xs text-[#75c5ae]">
            {search ? 'Ningún usuario coincide con tu búsqueda.' : 'Aún no hay usuarios autorizados en la lista.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const isMe = u.email.toLowerCase() === user?.email?.toLowerCase()
            const isUserAdmin = u.role === 'admin'

            return (
              <div
                key={u.id}
                className={clsx(
                  'p-3.5 bg-[#0a1f2f] border transition-all notch-sm flex items-center justify-between gap-3 group shadow-sm',
                  u.deleted
                    ? 'border-white/10 opacity-50'
                    : u.active
                      ? 'border-brand-500/20 hover:border-tropical_teal/40 hover:bg-white/[0.04]'
                      : 'border-red-500/30 opacity-70 bg-red-500/[0.03]',
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={clsx(
                    'w-9 h-9 notch-sm flex items-center justify-center text-sm font-bold flex-shrink-0',
                    isUserAdmin ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-brand-500/20 text-brand-300 border border-brand-500/30',
                  )}>
                    {isUserAdmin ? <Shield size={16} /> : u.name.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs sm:text-sm font-bold text-[#f3f5f6] group-hover:text-white transition-colors truncate">
                        {u.name}
                      </p>
                      {u.deleted && (
                        <span className="text-[10px] px-1.5 rounded bg-red-500/20 text-red-300 font-mono">Eliminado</span>
                      )}
                      {isMe && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-[#9aa4ac] font-mono">
                          Tú
                        </span>
                      )}
                      <span className={clsx(
                        'text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full font-mono',
                        isUserAdmin
                          ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                          : 'bg-brand-500/10 text-brand-400 border border-brand-500/20',
                      )}>
                        {isUserAdmin ? 'Administrador' : 'Integrante'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8a929a] font-mono truncate mt-0.5">
                      {u.email}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {u.deleted ? (
                    <button
                      onClick={() => handleRestore(u)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-brand-500/40 bg-brand-500/15 text-brand-300 hover:bg-brand-500/30 font-semibold flex items-center gap-1 transition"
                    >
                      <RotateCcw size={12} /> Restaurar
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={isMe}
                        title={u.active ? 'Desactivar usuario' : 'Activar usuario'}
                        className={clsx(
                          'text-xs px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 transition',
                          u.active
                            ? 'bg-brand-500/15 border-brand-500/40 text-brand-300 hover:bg-brand-500/30 hover:text-white'
                            : 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/30 hover:text-white',
                          isMe && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        {u.active ? <Check size={12} /> : <X size={12} />}
                        <span>{u.active ? 'Activo' : 'Inactivo'}</span>
                      </button>

                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg text-[#8a929a] hover:text-white hover:bg-white/10 transition"
                        title="Editar usuario y permisos"
                      >
                        <Pencil size={15} />
                      </button>

                      {!isMe && (
                        <button
                          onClick={() => handleDelete(u)}
                          className="p-1.5 rounded-lg text-[#8a929a] hover:text-red-400 hover:bg-red-500/20 transition"
                          title="Eliminar usuario"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: Crear / Editar Usuario */}
      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={editing ? 'Editar Usuario' : 'Autorizar Nuevo Usuario'}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-xs text-[#9aa4ac]">
            El integrante inicia sesión con su cuenta de Google usando este correo.
          </p>

          <Input
            label="Nombre completo"
            placeholder="ej. Nombre y apellido"
            {...register('name')}
            error={errors.name?.message}
          />

          <Input
            label="Correo electrónico"
            type="email"
            placeholder="ej. usuario@gmail.com"
            {...register('email')}
            error={errors.email?.message}
          />

          <Select
            label="Rol de acceso"
            options={[
              { value: 'integrante', label: 'Integrante (Miembro del hogar)' },
              { value: 'admin',      label: 'Administrador (Acceso total)' },
            ]}
            {...register('role')}
          />

          <div className="p-3 bg-[#0d263a] border border-white/[0.08] rounded-xl space-y-2">
            <p className="text-xs font-semibold text-[#f3f5f6]">Permisos</p>
            <div className="grid grid-cols-2 gap-1.5">
              {PERMISSIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-[11px] text-[#9aa4ac] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.includes(p.key)}
                    onChange={() => togglePermission(p.key)}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={saving} notched={true}>
              {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Autorizar Usuario'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
