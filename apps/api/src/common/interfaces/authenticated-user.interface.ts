export interface AuthenticatedUser {
  id: number;
  email: string;
  role: 'ADMIN' | 'CUSTOMER';
  fullName: string;
  /**
   * The user's own phone number, when set. Included so the customer profile
   * screen can prefill the field it is allowed to edit (`PATCH /customers/me`).
   */
  phone?: string | null;
}
