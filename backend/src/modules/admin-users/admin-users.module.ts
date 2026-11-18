import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';

import { AdminAuditLogsService } from './admin-audit-logs.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Admin-only user lifecycle lives apart from `user/` (self-service profile,
 * deletion, exports): the endpoints, guards and audit rules here are a
 * separate surface, mirroring how `cms/` keeps its admin API together.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, AdminAuditLogsService],
})
export class AdminUsersModule {}
