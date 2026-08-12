import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

const LIMIT = 5;

@Injectable()
export class MediaUploadRateLimitGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number } }>();
    const actorId = request.user?.id;
    if (!actorId || !Number.isSafeInteger(actorId)) return true;

    const allowed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO "MediaUploadRateLimit" ("actorId", "windowStartedAt", "requestCount", "updatedAt")
          VALUES (${actorId}, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
          ON CONFLICT ("actorId") DO UPDATE SET
            "windowStartedAt" = CASE
              WHEN "MediaUploadRateLimit"."windowStartedAt" <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
                THEN CURRENT_TIMESTAMP
              ELSE "MediaUploadRateLimit"."windowStartedAt"
            END,
            "requestCount" = CASE
              WHEN "MediaUploadRateLimit"."windowStartedAt" <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
                THEN 1
              ELSE "MediaUploadRateLimit"."requestCount" + 1
            END,
            "updatedAt" = CURRENT_TIMESTAMP
        `,
      );
      const row = await tx.mediaUploadRateLimit.findUniqueOrThrow({
        where: { actorId },
        select: { requestCount: true },
      });
      return row.requestCount <= LIMIT;
    });
    if (!allowed) {
      throw new HttpException(
        'Media upload rate limit exceeded.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
