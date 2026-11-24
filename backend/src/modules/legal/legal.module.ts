import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule } from '../../prisma/prisma.module';

import { ConsentEnforcementInterceptor } from './consent-enforcement.interceptor';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { LegalController } from './legal.controller';

@Module({
  imports: [PrismaModule],
  controllers: [LegalController, ConsentController],
  providers: [
    ConsentService,
    // Every JWT route, app-wide; exemptions are @AllowWithoutConsent().
    { provide: APP_INTERCEPTOR, useClass: ConsentEnforcementInterceptor },
  ],
  exports: [ConsentService],
})
export class LegalModule {}
