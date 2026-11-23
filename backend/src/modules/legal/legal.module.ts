import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';

import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { LegalController } from './legal.controller';

@Module({
  imports: [PrismaModule],
  controllers: [LegalController, ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class LegalModule {}
