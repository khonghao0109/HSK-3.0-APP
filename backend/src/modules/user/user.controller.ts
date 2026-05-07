import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

import { UserService } from './user.service';

type AuthenticatedUser = {
  id: number;
  email: string;
  role: string;
};

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  getMe(@Req() req: AuthenticatedRequest) {
    return this.userService.getProfile(req.user.id);
  }

  @Get()
  @Roles('admin')
  getAllUsers() {
    return this.userService.getAllUsers();
  }
}
