export interface AuthenticatedUser {
  id: number;
  email: string;
  role: 'ADMIN' | 'CUSTOMER';
  fullName: string;
}
