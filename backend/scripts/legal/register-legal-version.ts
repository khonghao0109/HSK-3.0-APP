import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Prisma, PrismaClient } from '@prisma/client';

import {
  LEGAL_DOCUMENT_TYPES,
  LEGAL_VERSION_PATTERN,
  type LegalDocumentTypeName,
} from '../../src/modules/legal/consent-state';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * M1.7b2 (Q187, Q197): records one published legal document version.
 *
 *   DATABASE_URL=... npm run legal:register-version -- \
 *     --type terms --version 1.0 --file docs/legal/terms-v1.0.md \
 *     --effective-at 2026-12-01T00:00:00+07:00
 *
 * The table is append-only: an existing (type, version) with the same hash and
 * effective date is left as is (exit 0); with a different hash or date nothing
 * is written and the script exits 1. Publishing for real belongs to M2.1f.
 */
type LegalType = LegalDocumentTypeName;
// An explicit offset avoids reading a local date in the server's time zone.
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type RegisterInput = {
  type: LegalType;
  version: string;
  sha256: string;
  effectiveAt: Date;
};

export type RegisterResult = {
  status: 'created' | 'unchanged' | 'rejected';
  type: LegalType;
  version: string;
  sha256: string;
  effectiveAt: string;
};

export function parseArgs(argv: readonly string[]): {
  type: LegalType;
  version: string;
  file: string;
  effectiveAt: Date;
} {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (
      !['--type', '--version', '--file', '--effective-at'].includes(key) ||
      value === undefined ||
      values.has(key)
    ) {
      throw new Error(`Invalid argument near "${key}"`);
    }
    values.set(key, value);
  }
  const type = values.get('--type');
  const version = values.get('--version');
  const file = values.get('--file');
  const effectiveRaw = values.get('--effective-at');
  if (!type || !version || !file || !effectiveRaw) {
    throw new Error(
      '--type, --version, --file and --effective-at are required',
    );
  }
  if (!(LEGAL_DOCUMENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(`--type must be one of ${LEGAL_DOCUMENT_TYPES.join(', ')}`);
  }
  if (!LEGAL_VERSION_PATTERN.test(version)) {
    throw new Error(`--version must match ${LEGAL_VERSION_PATTERN.source}`);
  }
  const effectiveAt = new Date(effectiveRaw);
  if (
    !ISO_WITH_ZONE.test(effectiveRaw) ||
    Number.isNaN(effectiveAt.getTime())
  ) {
    throw new Error('--effective-at must be ISO 8601 with Z or an offset');
  }
  return { type: type as LegalType, version, file, effectiveAt };
}

export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export async function registerLegalVersion(
  prisma: PrismaClient,
  input: RegisterInput,
): Promise<RegisterResult> {
  const inserted = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    INSERT INTO "LegalDocumentVersion" ("type", "version", "sha256", "effectiveAt")
    VALUES (${input.type}::"LegalDocumentType", ${input.version}, ${input.sha256}, ${input.effectiveAt})
    ON CONFLICT ("type", "version") DO NOTHING
    RETURNING id
  `);
  const base = {
    type: input.type,
    version: input.version,
    sha256: input.sha256,
    effectiveAt: input.effectiveAt.toISOString(),
  };
  if (inserted.length === 1) return { status: 'created', ...base };

  const existing = await prisma.legalDocumentVersion.findUniqueOrThrow({
    where: { type_version: { type: input.type, version: input.version } },
    select: { sha256: true, effectiveAt: true },
  });
  const same =
    existing.sha256 === input.sha256 &&
    existing.effectiveAt.getTime() === input.effectiveAt.getTime();
  return { status: same ? 'unchanged' : 'rejected', ...base };
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error(
      'Usage: npm run legal:register-version -- --type terms|privacy --version 1.0 --file <path> --effective-at <ISO 8601>',
    );
    process.exitCode = 2;
    return;
  }
  // PrismaService pins the session to UTC (C-05); `effectiveAt` is timestamp(3).
  const prisma = new PrismaService();
  try {
    const result = await registerLegalVersion(prisma, {
      type: args.type,
      version: args.version,
      sha256: sha256OfFile(args.file),
      effectiveAt: args.effectiveAt,
    });
    console.log(`RESULT ${JSON.stringify(result)}`);
    if (result.status === 'rejected') {
      console.error(
        `${result.type} ${result.version} already exists with a different hash or effective date; nothing written`,
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
