export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  householdId: string | null;
  createdAt: Date;
}
