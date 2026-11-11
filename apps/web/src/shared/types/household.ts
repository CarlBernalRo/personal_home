export interface Household {
  id: string;
  name: string;
  members: string[];
  memberNames?: Record<string, string>;
  memberPhotos?: Record<string, string | null>;
  /** Members with no account of their own (no login, no access to the app) — added directly by a real member, by name only. */
  guestIds?: string[];
  createdBy: string;
  inviteCode: string;
  createdAt: Date;
}
