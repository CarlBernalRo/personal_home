/** A pocket ("cuenta hija") lives inside another account: the money is physically in the parent. */
export const isPocket = (a: { parentId?: string | null }) => !!a.parentId;

type Acc = { id: string; balance: number; parentId?: string | null }

/**
 * The accounts as the screen should show them. A parent account keeps in the database only its own movements; what the bank
 * really holds is that plus whatever its pockets moved (a pocket's balance is signed: negative = spent on someone else's
 * behalf, so they owe it back; positive = their money you keep). The parent therefore shows its real balance (`balance`)
 * and keeps the raw one in `ownBalance`; pockets are left as they are. A pocket whose parent no longer exists stands alone.
 */
export function withPockets<T extends Acc>(accounts: T[]): (T & { ownBalance?: number; pocketCount?: number })[] {
  const ids = new Set(accounts.map((a) => a.id))
  const inside = new Map<string, T[]>()
  for (const a of accounts) if (a.parentId && ids.has(a.parentId)) inside.set(a.parentId, [...(inside.get(a.parentId) ?? []), a])
  return accounts.map((a) => {
    const kids = inside.get(a.id)
    if (!kids) return a.parentId && !ids.has(a.parentId) ? { ...a, parentId: undefined } : a
    return { ...a, ownBalance: a.balance, balance: a.balance + kids.reduce((s, k) => s + k.balance, 0), pocketCount: kids.length }
  })
}

/** The accounts that hold money on their own: pockets are already inside their parent's balance, so totals leave them out. */
export const topAccounts = <T extends { parentId?: string | null }>(accounts: T[]): T[] => accounts.filter((a) => !a.parentId)
