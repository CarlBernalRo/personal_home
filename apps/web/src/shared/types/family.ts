/** A request to join a family, made with its code and decided by an administrator. */
export interface FamilyRequest {
  name: string;
  photo: string | null;
  /** When it was sent (ISO). Requests older than FAMILY_REQUEST_DAYS are treated as expired. */
  at: string;
}

/** What one member lets the others see: whole categories of fixed expenses and/or single expenses. */
export interface FamilyShare {
  /** Fixed-expense categories shared whole (what is added to them later is shared too). */
  categories: string[];
  /** Single fixed expenses shared one by one. */
  expenseIds: string[];
  /** Who sees them: everybody in the family, or only these members. */
  with: 'all' | string[];
}

/**
 * A family: people who let each other see part of their expenses (unlike a household, nobody owes anybody here).
 * Joining is by code, but the code only sends a request; an administrator lets people in.
 */
export interface Family {
  id: string;
  name: string;
  createdBy: string;
  admins: string[];
  members: string[];
  memberNames: Record<string, string>;
  memberPhotos: Record<string, string | null>;
  /** Optional relationship of each member ("Pareja", "Hijo"…), only to show it. */
  relations: Record<string, string>;
  /** Join code; a new one makes the old one stop working. */
  code: string;
  /** False while the administrators don't accept requests. */
  open: boolean;
  requests: Record<string, FamilyRequest>;
  /** Requests that were turned down (uid → ISO date), so the person knows. */
  rejected: Record<string, string>;
  shares: Record<string, FamilyShare>;
  createdAt?: Date;
}

/** Days a request waits for an answer before it expires. */
export const FAMILY_REQUEST_DAYS = 7;

export const FAMILY_RELATIONS = ['Pareja', 'Esposo/a', 'Hijo/a', 'Papá', 'Mamá', 'Hermano/a', 'Abuelo/a', 'Otro'] as const;

/** Is this request still waiting (not expired)? */
export const requestAlive = (r: FamilyRequest, now = new Date()) =>
  now.getTime() - new Date(r.at).getTime() < FAMILY_REQUEST_DAYS * 86_400_000;

/** Who may see one of `owner`'s fixed expenses, by what `owner` chose to share (sorted, without the owner). */
export function viewersOf(fe: { id: string; category?: string }, family: Pick<Family, 'members' | 'shares'> | null, owner: string): string[] {
  if (!family || !family.members.includes(owner)) return [];
  const share = family.shares?.[owner];
  if (!share) return [];
  const matches = (share.expenseIds ?? []).includes(fe.id) || (!!fe.category && (share.categories ?? []).includes(fe.category));
  if (!matches) return [];
  const others = family.members.filter((u) => u !== owner);
  const chosen = !share.with || share.with === 'all' ? others : share.with.filter((u) => others.includes(u));
  return [...chosen].sort();
}

export const sameList = (a: string[] = [], b: string[] = []) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
