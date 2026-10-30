export interface Household {
  id: string;
  name: string;
  members: string[];
  memberNames?: Record<string, string>;
  memberPhotos?: Record<string, string | null>;
  createdBy: string;
  inviteCode: string;
  createdAt: Date;
}
