import { Module } from '@nestjs/common';
import { DictionaryModule } from './modules/dictionary/dictionary.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [DictionaryModule, HealthModule, PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
