import { Module } from '@nestjs/common';

import { PostgresThrottlerStorage } from './postgres-throttler.storage';

@Module({
  providers: [PostgresThrottlerStorage],
  exports: [PostgresThrottlerStorage],
})
export class RateLimitModule {}
