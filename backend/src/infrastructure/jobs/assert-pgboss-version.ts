import type { PrismaService } from '../../prisma/prisma.service';

export async function assertPgBossVersion(
  prisma: Pick<PrismaService, '$queryRawUnsafe'>,
): Promise<void> {
  let res: { version: number }[];
  try {
    res = await prisma.$queryRawUnsafe<{ version: number }[]>(
      'SELECT version FROM pgboss.version',
    );
  } catch {
    throw new Error('schema not found');
  }

  const version = res[0]?.version;
  if (version === undefined || String(version) !== '43') {
    throw new Error(`pg-boss schema version must be 43, but got ${version}`);
  }
}
