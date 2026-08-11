import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockActiveCmsActor(
  tx: Prisma.TransactionClient,
  actorId: number,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT id FROM "User" WHERE id = ${actorId} AND role = 'admin' AND status = 'active' AND "deletedAt" IS NULL FOR SHARE`,
  );
  if (rows.length !== 1) {
    throw new UnauthorizedException('Account is not available.');
  }
}
