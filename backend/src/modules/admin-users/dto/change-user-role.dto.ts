import { IsIn } from 'class-validator';

export class ChangeUserRoleDto {
  @IsIn(['user', 'admin'])
  role!: 'user' | 'admin';
}
