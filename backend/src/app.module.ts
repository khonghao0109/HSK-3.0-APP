import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import jwtConfig from './config/jwt.config';
import mediaConfig from './config/media.config';
import { AuthModule } from './modules/auth/auth.module';
import { CmsModule } from './modules/cms/cms.module';
import { DictionaryModule } from './modules/dictionary/dictionary.module';
import { HealthModule } from './modules/health/health.module';
import { LearningModule } from './modules/learning/learning.module';
import { MediaModule } from './modules/media/media.module';
import { MediaObservabilityModule } from './infrastructure/observability/media-observability.module';
import { PostgresThrottlerStorage } from './infrastructure/rate-limit/postgres-throttler.storage';
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { UserModule } from './modules/user/user.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, mediaConfig],
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [PostgresThrottlerStorage],
      useFactory: (storage: PostgresThrottlerStorage) => ({
        throttlers: [
          {
            ttl: 60_000,
            // Browser E2E deliberately exercises many authenticated navigations from
            // one loopback address. Production keeps the fail-closed global limit.
            limit: process.env.NODE_ENV === 'test' ? 1_000 : 20,
          },
        ],
        // Counters live in PostgreSQL so all replicas enforce one limit.
        storage,
      }),
    }),
    PrismaModule,
    MediaObservabilityModule,
    AuthModule,
    CmsModule,
    UserModule,
    DictionaryModule,
    HealthModule,
    LearningModule,
    MediaModule,
    OnboardingModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    // One response envelope for every JSON success and error (review A-03).
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
