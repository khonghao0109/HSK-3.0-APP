/** TL-61: the exact admin list projection; no credential or lockout fields. */
export class AdminUserDto {
  id!: number;
  email!: string;
  name!: string | null;
  role!: 'user' | 'admin';
  status!: 'active' | 'suspended' | 'deletion_pending';
  lastLoginAt!: Date | null;
  createdAt!: Date;
}
