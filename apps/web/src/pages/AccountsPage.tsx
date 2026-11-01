import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Edit2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/hooks/useAuth'
import { addAccount, getAccounts, updateAccount, deleteAccount } from '@/lib/firestore'
import { formatCOP } from '@/shared'
import type { AccountType } from '@/shared'
import { AppIcon, EmptyMark } from '@/components/ui/AppIcon'

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'checking', label: 'Cuenta corriente', icon: 'bank' },
  { value: 'savings', label: 'Cuenta de ahorros', icon: 'savings' },
  { value: 'cash', label: 'Efectivo', icon: 'cash' },
  { value: 'investment', label: 'Inversión', icon: 'invest' },
]

const COLORS = ['#52b69a', '#34a0a4', '#168aad', '#76c893', '#d9ed92', '#1a759f', '#1e6091']

const schema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  type: z.enum(['checking', 'savings', 'cash', 'investment']),
  balance: z.coerce.number().min(0, 'El saldo no puede ser negativo'),
  color: z.string(),
})

type FormData = z.infer<typeof schema>

export default function AccountsPage() {
  const ask = useConfirm()
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'checking', balance: 0, color: COLORS[0] },
  })

  async function load() {
    if (!user) return
    const data = await getAccounts(user.uid)
    setAccounts(data as any[])
    setLoading(false)
  }

  useEffect(() => { load() }, [user])

  function openCreate() {
    setEditItem(null)
    reset({ type: 'checking', balance: 0, color: COLORS[0] })
    setOpen(true)
  }

  function openEdit(acc: any) {
    setEditItem(acc)
    reset({ name: acc.name, type: acc.type, balance: acc.balance, color: acc.color })
    setOpen(true)
  }

  async function onSubmit(data: FormData) {
    if (!user) return
    setSaving(true)
    if (editItem) {
      await updateAccount(editItem.id, data)
    } else {
      await addAccount({ ...data, userId: user.uid, currency: 'COP' })
    }
    reset()
    setOpen(false)
    setSaving(false)
    load()
  }

  async function handleDelete(id: string) {
    if (!(await ask('¿Eliminar esta cuenta?', { title: 'Eliminar cuenta' }))) return
    await deleteAccount(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cuentas</h1>
          <p className="text-sm text-gray-500">Saldo total: <span className="font-semibold text-brand-600">{formatCOP(totalBalance)}</span></p>
        </div>
        <Button onClick={openCreate} size="sm"><Plus size={16} /> Nueva</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>
      ) : accounts.length === 0 ? (
        <Card className="text-center py-10">
          <EmptyMark name="debt" />
          <p className="text-sm text-gray-500">No tienes cuentas registradas.</p>
          <p className="text-xs text-gray-400 mt-1">Agrega tus cuentas para llevar el control.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc: any) => {
            const typeInfo = ACCOUNT_TYPES.find((t) => t.value === acc.type)
            return (
              <Card key={acc.id} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ backgroundColor: acc.color + '20' }}>
                    <AppIcon name={typeInfo?.icon ?? 'debt'} size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{acc.name}</p>
                    <p className="text-xs text-gray-400">{typeInfo?.label ?? acc.type}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold" style={{ color: acc.color }}>{formatCOP(acc.balance)}</p>
                  </div>
                  <div className="flex gap-1 ml-1">
                    <button onClick={() => openEdit(acc)} className="p-1.5 text-gray-400 hover:text-brand-600 transition"><Edit2 size={15} /></button>
                    <button onClick={() => handleDelete(acc.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition"><Trash2 size={15} /></button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editItem ? 'Editar cuenta' : 'Nueva cuenta'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label="Nombre" placeholder="ej. Bancolombia ahorros" {...register('name')} error={errors.name?.message} />
          <Select label="Tipo" options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }))} {...register('type')} />
          <Input label="Saldo actual (COP)" money placeholder="0" {...register('balance')} error={errors.balance?.message} />
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Color</p>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setValue('color', c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 ring-2 ring-offset-2 ring-transparent focus:ring-brand-500"
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
