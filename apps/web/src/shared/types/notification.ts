/** The zone of the app an alert belongs to; the notification center groups and filters by it. */
export type NotificationZone = 'sueldo' | 'fijos' | 'gastos' | 'hogar';

/** critical: needs action now · warning: coming up · info: for your information · success: good news. */
export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'success';

/** A payment between household members that the receiver has to confirm (and say which bank it landed in). */
export interface PaymentReceipt {
  householdId: string;
  /** Groups the abonos of that one payment. */
  paymentId: string;
  amount: number;
  fromName: string;
  /** What the money went to: one line per debt it paid. */
  lines: { concept: string; amount: number }[];
  /** ISO date of the payment. */
  date: string;
  /** Set once the receiver confirmed it. */
  confirmed?: boolean;
}

/** A notification stored in Firestore: something another person did that concerns the recipient. */
export interface StoredNotification {
  id: string;
  /** Recipient. */
  userId: string;
  zone: NotificationZone;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** In-app route the alert points at. */
  link?: string;
  read: boolean;
  /** Who caused it (it is never shown to that same person). */
  fromUid: string;
  /** Present when the receiver has to confirm money they were paid. */
  receipt?: PaymentReceipt;
  /** Dismissed by the person: it leaves the active list but stays in the history. */
  archived?: boolean;
  /** A copy of an alert worked out from the person's own data, kept so it stays in the history after it is solved. */
  derivedKey?: string;
  createdAt: Date;
}

export type NewStoredNotification = Omit<StoredNotification, 'id' | 'createdAt' | 'read'>;

export type InviteStatus = 'pending' | 'accepted' | 'declined';

/** An invitation to join a household, addressed by e-mail. */
export interface HouseholdInvite {
  id: string;
  householdId: string;
  householdName: string;
  /** Lets the invited person join without looking the household up. */
  inviteCode: string;
  /** Lower-case e-mail of the invited person. */
  email: string;
  invitedBy: string;
  invitedByName: string;
  status: InviteStatus;
  createdAt: Date;
}

export type NewHouseholdInvite = Omit<HouseholdInvite, 'id' | 'createdAt' | 'status'>;

/** What the notification center lists: stored events, alerts worked out from the data, and pending invitations. */
export interface AppNotification {
  /** Stable key (stored: the document id; derived: built from what it is about). */
  key: string;
  source: 'stored' | 'derived' | 'invite';
  zone: NotificationZone;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: Date;
  invite?: HouseholdInvite;
  receipt?: PaymentReceipt;
  /** Only in the history: dismissed by the person. */
  archived?: boolean;
  /** Only in the history: this one is a saved copy of an alert that comes from the person's data. */
  derivedKey?: string;
}
