import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Check, Copy, Crown, Heart, LogIn, LogOut, Plus, RefreshCw, Shield, Trash2, UserMinus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { AppIcon } from '@/components/ui/AppIcon'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { ChipSelect } from '@/components/ui/ChipSelect'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useDisplayName } from '@/hooks/useDisplayName'
import { useFamily } from '@/hooks/useFamily'
import { getFixedExpenses } from '@/lib/firestore'
import {
  acceptRequest, cancelRequest, createFamily, deleteFamily, findFamilyByCode, leaveFamily, regenerateCode, rejectRequest, removeMember,
  renameFamily, requestToJoin, saveMyShare, setAdmin, setOpen, setRelation, syncFamilySharing,
} from '@/lib/family'
import { FAMILY_RELATIONS, FIXED_EXPENSE_CATEGORIES, requestAlive, type Family } from '@/shared'

const RELATION_OPTIONS = FAMILY_RELATIONS.map((x) => ({ value: x, label: x }))
const card = 'rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-4 shadow-xl'
const eyebrow = 'font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold'

/**
 * Familia: create one or ask to join one with its code (an administrator lets people in), manage the members and,
 * for each person, choose which fixed expenses the others can see.
 */
export function FamilyForm() {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const myName = useDisplayName() || 'Yo'
  const { showToast } = useToast()
  const ask = useConfirm()
  const { family, loading, requested, requestedFamily, requestState, isAdmin } = useFamily()
  const uid = user?.uid ?? ''
  const me = { name: myName, photo: user?.photoURL ?? null }

  if (loading) return <div className={card}><p className="text-sm text-[#9aa4ac]">Cargando…</p></div>

  const clearRequestOnProfile = () => setProfile({ ...(profile as any), familyRequest: undefined } as any)

  if (!family) {
    // a request that waits too long counts as expired
    const expired = requestState === 'pending' && requestedFamily?.requests[uid] && !requestAlive(requestedFamily.requests[uid])
    if (requested && requestState !== 'none') {
      return (
        <div className={card}>
          <p className={eyebrow}>Tu solicitud</p>
          {requestState === 'pending' && !expired ? (
            <>
              <p className="text-sm text-[#f0fae8]">Pediste unirte a <span className="font-bold">{requested.familyName}</span>.</p>
              <p className="text-xs text-[#9aa4ac]">Esperando a que un administrador la acepte. Te avisaremos cuando responda.</p>
            </>
          ) : requestState === 'rejected' ? (
            <p className="text-sm text-[#f0fae8]">No te aceptaron en <span className="font-bold">{requested.familyName}</span>.</p>
          ) : (
            <p className="text-sm text-[#f0fae8]">La solicitud a <span className="font-bold">{requested.familyName}</span> venció o la familia ya no existe. Puedes volver a pedir con un código.</p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await cancelRequest(requested.familyId, uid)
              clearRequestOnProfile()
              showToast(requestState === 'pending' && !expired ? 'Solicitud cancelada' : 'Listo', 'success')
            }}
          >
            {requestState === 'pending' && !expired ? <><X size={14} /> Cancelar solicitud</> : <><Check size={14} /> Entendido</>}
          </Button>
        </div>
      )
    }
    return <NoFamily me={me} onRequested={(f) => setProfile({ ...(profile as any), familyRequest: { familyId: f.id, familyName: f.name, at: new Date().toISOString() } } as any)} />
  }

  return <InFamily family={family} uid={uid} isAdmin={isAdmin} ask={ask} />
}

// ── Without a family: create one or ask to join ──────────────────────────────

function NoFamily({ me, onRequested }: { me: { name: string; photo: string | null }; onRequested: (f: Family) => void }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [found, setFound] = useState<Family | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!user) return
    setBusy(true)
    try { await createFamily(user.uid, name, me); showToast('Familia creada', 'success') }
    catch { showToast('No se pudo crear la familia', 'error') }
    finally { setBusy(false) }
  }

  async function lookUp() {
    setError(null); setFound(null)
    if (code.trim().length < 6) { setError('El código tiene 6 caracteres'); return }
    setBusy(true)
    try {
      const f = await findFamilyByCode(code)
      if (!f) setError('No hay ninguna familia con ese código')
      else if (!f.open) setError('Esa familia no está recibiendo solicitudes por ahora')
      else setFound(f)
    } catch { setError('No se pudo buscar el código') }
    finally { setBusy(false) }
  }

  async function send() {
    if (!user || !found) return
    setBusy(true)
    try { await requestToJoin(found, user.uid, me); onRequested(found); showToast('Solicitud enviada', 'success') }
    catch { showToast('No se pudo enviar la solicitud', 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-300 flex-shrink-0"><Heart size={18} /></span>
          <div>
            <p className="text-sm font-bold text-[#f0fae8]">Tu familia en la app</p>
            <p className="text-xs text-[#9aa4ac] mt-0.5">
              Cada uno lleva sus cuentas, pero puede dejar ver a los suyos algunos gastos fijos (por ejemplo los servicios). Por defecto no se comparte nada,
              y nadie entra sin que un administrador lo acepte. Es distinto de Hogar: aquí nadie le debe a nadie.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className={card}>
          <p className={eyebrow}>Crear mi familia</p>
          <Input label="Nombre" placeholder="ej. Familia Bernal" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" notched onClick={create} disabled={busy}><Plus size={14} /> Crear familia</Button>
          <p className="text-[11px] text-[#8a929a]">Serás su administrador: compartes el código y apruebas quién entra.</p>
        </div>

        <div className={card}>
          <p className={eyebrow}>Unirme con un código</p>
          <Input label="Código de la familia" placeholder="ABC123" maxLength={6} value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setFound(null); setError(null) }} error={error ?? undefined} />
          {!found ? (
            <Button size="sm" variant="secondary" onClick={lookUp} disabled={busy}><LogIn size={14} /> Buscar</Button>
          ) : (
            <div className="space-y-3 rounded-xl border border-brand-400/30 bg-brand-500/5 p-3">
              <p className="text-sm text-[#f0fae8]"><span className="font-bold">{found.name}</span></p>
              <p className="text-xs text-[#9aa4ac]">
                Administra: {found.admins.map((a) => found.memberNames[a] ?? 'Integrante').join(', ')} · {found.members.length} {found.members.length === 1 ? 'integrante' : 'integrantes'}
              </p>
              <Button size="sm" notched onClick={send} disabled={busy}>Enviar solicitud</Button>
              <p className="text-[11px] text-[#8a929a]">Un administrador debe aceptarte. Mientras tanto no ves nada de la familia.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── In a family ──────────────────────────────────────────────────────────────

function InFamily({ family, uid, isAdmin, ask }: { family: Family; uid: string; isAdmin: boolean; ask: ReturnType<typeof useConfirm> }) {
  const { showToast } = useToast()
  const myName = useDisplayName() || 'Un administrador'
  const nameOf = (u: string) => (u === uid ? 'Tú' : family.memberNames[u] ?? 'Integrante')
  const alive = Object.entries(family.requests).filter(([, r]) => requestAlive(r)).sort((a, b) => a[1].at.localeCompare(b[1].at))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [relationFor, setRelationFor] = useState<Record<string, string>>({})

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); showToast(ok, 'success') } catch { showToast('No se pudo completar', 'error') }
  }

  async function leave() {
    const lastAdmin = isAdmin && family.admins.length === 1 && family.members.length > 1
    if (lastAdmin) { showToast('Antes de salir, nombra a otro administrador', 'error'); return }
    // the only one left: leaving would leave an empty family behind, so it is deleted instead
    const alone = family.members.length === 1
    const text = alone
      ? `Eres el único integrante de "${family.name}": al salir, la familia se elimina y su código deja de servir. ¿Continuar?`
      : `¿Salir de "${family.name}"? La familia sigue para los demás; tú dejas de compartir tus gastos y de ver los de ellos.`
    if (!(await ask(text, { title: alone ? 'Eliminar la familia' : 'Salir de la familia', confirmLabel: alone ? 'Salir y eliminar' : 'Salir' }))) return
    await run(() => (alone ? deleteFamily(family, uid, myName) : leaveFamily(family.id, uid)), alone ? 'Familia eliminada' : 'Saliste de la familia')
  }

  async function remove() {
    const ok = await ask(
      `¿Eliminar "${family.name}" para todos? Sus ${family.members.length} integrantes dejan de compartir y de ver gastos entre sí, y el código deja de servir. No se borra ningún gasto ni pago de nadie.`,
      { title: 'Eliminar la familia', confirmLabel: 'Eliminar familia' },
    )
    if (!ok) return
    await run(() => deleteFamily(family, uid, myName), 'Familia eliminada')
  }

  return (
    <div className="space-y-5">
      {/* The family, and its code for the administrators */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={eyebrow}>Mi familia</p>
            {renaming !== null ? (
              <div className="flex items-center gap-2 mt-1">
                <Input value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Nombre de la familia" />
                <Button size="sm" onClick={() => run(async () => { await renameFamily(family.id, renaming); setRenaming(null) }, 'Nombre actualizado')}><Check size={14} /></Button>
                <Button size="sm" variant="secondary" onClick={() => setRenaming(null)}><X size={14} /></Button>
              </div>
            ) : (
              <p className="text-lg font-bold text-[#f0fae8] mt-0.5">
                {family.name}
                {isAdmin && <button type="button" onClick={() => setRenaming(family.name)} className="ml-2 text-[11px] font-semibold text-brand-300 hover:text-brand-200">Renombrar</button>}
              </p>
            )}
            <p className="text-xs text-[#9aa4ac]">{family.members.length} {family.members.length === 1 ? 'integrante' : 'integrantes'} · {isAdmin ? 'eres administrador' : `administra ${family.admins.map(nameOf).join(', ')}`}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <button type="button" onClick={leave} className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-300 hover:text-rose-200"><LogOut size={13} /> Salir de la familia</button>
            {isAdmin && family.members.length > 1 && (
              <button type="button" onClick={remove} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300"><Trash2 size={13} /> Eliminar la familia</button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Código para pedir entrar</p>
              <p className="font-mono text-xl font-bold tracking-[0.3em] text-[#f0fae8]">{family.code}</p>
            </div>
            <div className="flex flex-wrap gap-2 ml-auto">
              <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(family.code); showToast('Código copiado', 'success') }}><Copy size={13} /> Copiar</Button>
              <Button size="sm" variant="secondary" onClick={async () => { if (await ask('¿Generar otro código? El actual deja de servir; las solicitudes ya enviadas se conservan.', { title: 'Nuevo código', confirmLabel: 'Generar' })) run(() => regenerateCode(family.id), 'Código nuevo listo') }}><RefreshCw size={13} /> Otro código</Button>
              <Button size="sm" variant="secondary" onClick={() => run(() => setOpen(family.id, !family.open), family.open ? 'Solicitudes pausadas' : 'Solicitudes abiertas')}>
                {family.open ? 'Pausar solicitudes' : 'Abrir solicitudes'}
              </Button>
            </div>
            <p className="basis-full text-[11px] text-[#8a929a]">
              {family.open ? 'Quien tenga el código puede pedir entrar; tú decides si lo aceptas.' : 'Las solicitudes están pausadas: el código no sirve hasta que las abras.'}
            </p>
          </div>
        )}
      </div>

      {/* Requests, for the administrators */}
      {isAdmin && alive.length > 0 && (
        <div className={card}>
          <p className={eyebrow}>Solicitudes para entrar ({alive.length})</p>
          <ul className="space-y-2">
            {alive.map(([u, r]) => (
              <li key={u} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
                <Avatar name={r.name} photoURL={r.photo} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#f0fae8]">{r.name}</p>
                  <p className="text-[11px] text-[#8a929a]">Pidió entrar el {format(new Date(r.at), "d 'de' MMMM", { locale: es })}</p>
                </div>
                <ChipSelect
                  size="sm"
                  label={`Parentesco de ${r.name}`}
                  placeholder="Parentesco (opcional)"
                  value={relationFor[u] ?? ''}
                  onChange={(v) => setRelationFor({ ...relationFor, [u]: v })}
                  options={RELATION_OPTIONS}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => run(() => rejectRequest(family, u, uid), 'Solicitud rechazada')}><X size={13} /> Rechazar</Button>
                  <Button size="sm" notched onClick={() => run(() => acceptRequest(family, u, uid, relationFor[u]), `${r.name} ya es parte de la familia`)}><Check size={13} /> Aceptar</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Members */}
      <div className={card}>
        <p className={eyebrow}>Integrantes</p>
        <ul className="divide-y divide-white/[0.06]">
          {family.members.map((u) => {
            const admin = family.admins.includes(u)
            const canEditRelation = isAdmin || u === uid
            return (
              <li key={u} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={family.memberNames[u] ?? '?'} photoURL={family.memberPhotos[u]} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#f0fae8] break-words">
                    {nameOf(u)}
                    {admin && <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300"><Crown size={9} /> Admin</span>}
                  </p>
                  {canEditRelation ? (
                    <ChipSelect
                      className="mt-1"
                      label={`Parentesco de ${nameOf(u)}`}
                      placeholder="Sin parentesco"
                      value={family.relations[u] ?? ''}
                      onChange={(v) => run(() => setRelation(family.id, u, v), 'Parentesco actualizado')}
                      options={RELATION_OPTIONS}
                    />
                  ) : (
                    <p className="text-[11px] text-[#8a929a]">{family.relations[u] || 'Sin parentesco'}</p>
                  )}
                </div>
                </div>
                {/* phones: the actions get their own line under the name, sharing the width; wider: beside it */}
                {isAdmin && u !== uid && (
                  <div className="flex gap-2 pl-[46px] sm:pl-0 sm:flex-shrink-0">
                    <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" onClick={() => run(() => setAdmin(family.id, u, !admin), admin ? 'Ya no es administrador' : 'Ahora es administrador')}>
                      <Shield size={13} /> {admin ? 'Quitar admin' : 'Hacer admin'}
                    </Button>
                    <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" onClick={async () => { if (await ask(`¿Sacar a ${nameOf(u)} de la familia? Deja de ver lo que se comparte y los demás dejan de ver lo suyo.`, { title: 'Sacar de la familia', confirmLabel: 'Sacar' })) run(() => removeMember(family.id, u), `${nameOf(u)} salió de la familia`) }}>
                      <UserMinus size={13} /> Sacar
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <MyShare family={family} uid={uid} />
    </div>
  )
}

// ── What I share ─────────────────────────────────────────────────────────────

function MyShare({ family, uid }: { family: Family; uid: string }) {
  const { showToast } = useToast()
  const current = family.shares[uid]
  const others = family.members.filter((u) => u !== uid)
  const [categories, setCategories] = useState<string[]>(current?.categories ?? [])
  const [expenseIds, setExpenseIds] = useState<string[]>(current?.expenseIds ?? [])
  const [withAll, setWithAll] = useState(!current || current.with === 'all')
  const [withSome, setWithSome] = useState<string[]>(Array.isArray(current?.with) ? current!.with : [])
  const [expenses, setExpenses] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  // archived ones aren't offered for sharing (their past payments stay shared as they were)
  useEffect(() => { getFixedExpenses(uid).then((x) => setExpenses((x as any[]).filter((e) => !e.archivedAt))).catch(() => setExpenses([])) }, [uid])
  // what is stored changes (another tab, a member left): start again from it
  useEffect(() => {
    setCategories(current?.categories ?? [])
    setExpenseIds(current?.expenseIds ?? [])
    setWithAll(!current || current.with === 'all')
    setWithSome(Array.isArray(current?.with) ? current!.with : [])
  }, [JSON.stringify(current)]) // eslint-disable-line react-hooks/exhaustive-deps

  // expenses already covered by a shared category don't need picking one by one
  const loose = useMemo(() => expenses.filter((e) => !categories.includes(e.category)).sort((a, b) => String(a.concept).localeCompare(String(b.concept), 'es')), [expenses, categories])
  const covered = expenses.filter((e) => categories.includes(e.category) || expenseIds.includes(e.id))
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  // with only one other person there is nobody to choose between; "some" with nobody picked would share with nobody
  const choosing = others.length > 1
  const shareWith: 'all' | string[] = !choosing || withAll ? 'all' : withSome
  const nobody = choosing && !withAll && withSome.length === 0

  async function save() {
    if (nobody) { showToast('Elige con quién compartir, o marca "Toda la familia"', 'error'); return }
    setSaving(true)
    try {
      await saveMyShare(family.id, uid, { categories, expenseIds: expenseIds.filter((id) => loose.some((e) => e.id === id)), with: shareWith })
      // the records are opened (or closed) to the right people right away
      await syncFamilySharing(uid, { ...family, shares: { ...family.shares, [uid]: { categories, expenseIds, with: shareWith } } })
      showToast('Listo: se actualizó lo que compartes', 'success')
    } catch {
      showToast('No se pudo guardar lo que compartes', 'error')
    } finally {
      setSaving(false)
    }
  }

  const usedCategories = FIXED_EXPENSE_CATEGORIES.filter((c) => expenses.some((e) => e.category === c.id) || categories.includes(c.id))

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={eyebrow}>Qué comparto</p>
          <p className="text-xs text-[#9aa4ac] mt-1">Elige qué gastos fijos pueden ver. Ven el concepto, el monto, la fecha de pago y si ya está pagado; nunca tus cuentas, tu sueldo ni tus demás gastos.</p>
        </div>
        {others.length > 0 && <Link to="/dinero" className="text-[11px] font-semibold text-brand-300 hover:text-brand-200 whitespace-nowrap">Ver lo que me comparten →</Link>}
      </div>

      {others.length === 0 ? (
        <p className="text-sm text-[#9aa4ac]">Cuando alguien más entre a la familia podrás elegir qué compartir.</p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#c7ccd1]">Categorías completas <span className="font-normal text-[#8a929a]">(incluye lo que agregues después en ellas)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {usedCategories.map((c) => {
                const on = categories.includes(c.id)
                return (
                  <button key={c.id} type="button" onClick={() => toggle(categories, setCategories, c.id)} aria-pressed={on}
                    className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition', on ? 'text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white')}
                    style={on ? { backgroundColor: c.color + '33', borderColor: c.color } : undefined}>
                    {on ? <Check size={12} /> : <AppIcon name={c.icon} size={13} />} {c.label}
                  </button>
                )
              })}
              {usedCategories.length === 0 && <p className="text-xs text-[#8a929a]">Aún no tienes gastos fijos.</p>}
            </div>
          </div>

          {loose.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#c7ccd1]">Gastos sueltos</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {loose.map((e) => {
                  const on = expenseIds.includes(e.id)
                  return (
                    <label key={e.id} className={clsx('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition', on ? 'border-brand-400/50 bg-brand-500/10 text-white' : 'border-white/10 text-[#c7ccd1] hover:bg-white/5')}>
                      <input type="checkbox" checked={on} onChange={() => toggle(expenseIds, setExpenseIds, e.id)} />
                      <span className="truncate">{e.concept}</span>
                      {e.oneTime && <span className="ml-auto text-[9px] uppercase tracking-wider text-sky-300">programado</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {choosing && <div className="space-y-2">
            <p className="text-xs font-semibold text-[#c7ccd1]">Con quién</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setWithAll(true)} aria-pressed={withAll} className={clsx('rounded-lg border px-3 py-1.5 text-xs font-semibold transition', withAll ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-[#9aa4ac] hover:text-white')}>Toda la familia</button>
              <button type="button" onClick={() => setWithAll(false)} aria-pressed={!withAll} className={clsx('rounded-lg border px-3 py-1.5 text-xs font-semibold transition', !withAll ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-[#9aa4ac] hover:text-white')}>Solo algunos</button>
              {!withAll && (
                <MultiSelect label="Integrantes" allLabel="Nadie" value={withSome} onChange={setWithSome}
                  options={others.map((u) => ({ value: u, label: family.memberNames[u] ?? 'Integrante' }))} />
              )}
            </div>
            {nobody && <p className="text-[11px] text-amber-300">Marca al menos una persona, o elige "Toda la familia".</p>}
          </div>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
            <p className="text-xs text-[#9aa4ac]">
              {covered.length === 0 ? 'No estás compartiendo ningún gasto.' : `Compartes ${covered.length} ${covered.length === 1 ? 'gasto fijo' : 'gastos fijos'} con ${!choosing ? (family.memberNames[others[0]] ?? 'tu familiar') : withAll ? 'toda la familia' : withSome.length ? withSome.map((u) => family.memberNames[u] ?? 'Integrante').join(', ') : 'nadie todavía'}.`}
            </p>
            <Button size="sm" notched onClick={save} disabled={saving || nobody}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </>
      )}
    </div>
  )
}
