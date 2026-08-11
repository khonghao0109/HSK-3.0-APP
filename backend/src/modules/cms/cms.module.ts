import { Module } from '@nestjs/common';

import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
import { CmsTransactionCoordinator } from './cms-transaction-coordinator';

@Module({
  controllers: [CmsController],
  providers: [CmsService, CmsTransactionCoordinator],
  exports: [CmsService],
})
export class CmsModule {}
