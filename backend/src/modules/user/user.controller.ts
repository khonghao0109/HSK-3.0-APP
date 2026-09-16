import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
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
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  getMe(@Req() req: AuthenticatedRequest) {
    return this.userService.getProfile(req.user.id);
  }

  @Get()
  @Roles('admin')
  getAllUsers(@Query() query: PaginationQueryDto) {
    return this.userService.getAllUsers(query);
  }
}
