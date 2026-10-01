import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { PrismaModule } from '../../prisma/prisma.module';

import { DataExportService } from './data-export.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [UserController],
  providers: [UserService, DataExportService],
  exports: [UserService, DataExportService],
})
export class UserModule {}
