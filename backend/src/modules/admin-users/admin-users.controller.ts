import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../common/pipes/parse-positive-safe-integer.pipe';
import { correlationId } from '../../common/utils/request-correlation';

import { AdminAuditLogsService } from './admin-audit-logs.service';
import { AdminUsersService } from './admin-users.service';
import { AdminAuditLogDto } from './dto/admin-audit-log-response.dto';
import { AdminAuditLogsQueryDto } from './dto/admin-audit-logs-query.dto';
import { AdminUserDto } from './dto/admin-user-response.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly adminAuditLogsService: AdminAuditLogsService,
  ) {}

  @Get('users')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope([AdminUserDto], { paginated: true })
  listUsers(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminUsersQueryDto,
  ) {
    return this.adminUsersService.listUsers(request.user, query);
  }

  @Patch('users/:id/role')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(AdminUserDto)
  changeRole(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParsePositiveSafeIntegerPipe) userId: number,
    @Body() dto: ChangeUserRoleDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminUsersService.changeRole(request.user, userId, dto.role, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('users/:id/suspend')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(AdminUserDto)
  suspend(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParsePositiveSafeIntegerPipe) userId: number,
    @Body() dto: SuspendUserDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    // Validation proved `reason` is a string; the DTO types it as `unknown`
    // so implicit conversion cannot accept a JSON number or boolean.
    if (typeof dto.reason !== 'string') {
      throw new BadRequestException('Reason must be a string.');
    }
    return this.adminUsersService.suspend(request.user, userId, dto.reason, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('users/:id/unsuspend')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(AdminUserDto)
  unsuspend(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParsePositiveSafeIntegerPipe) userId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminUsersService.unsuspend(request.user, userId, {
      correlationId: correlationId(requestId),
    });
  }

  @Get('audit-logs')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope([AdminAuditLogDto], { paginated: true })
  listAuditLogs(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminAuditLogsQueryDto,
  ) {
    return this.adminAuditLogsService.listAuditLogs(request.user, query);
  }
}
