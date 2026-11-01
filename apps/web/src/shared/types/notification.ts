/** The zone of the app an alert belongs to; the notification center groups and filters by it. */
export type NotificationZone = 'sueldo' | 'fijos' | 'gastos' | 'hogar';

/** critical: needs action now · warning: coming up · info: for your information · success: good news. */
export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'success';

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
}
