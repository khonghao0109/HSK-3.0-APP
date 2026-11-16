import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { normalizePinyin } from '../../src/common/utils/normalize-pinyin';
import { DictionaryService } from '../../src/modules/dictionary/dictionary.service';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * `test:db:dictionary-search` (M3.4a, Q295): WordExample constraints in SQL,
 * then the R6 ranking of `GET /dictionary` against the real database. Fixture
 * words carry a run tag and are deleted again in `finally`.
 */
const { databaseName, testDatabaseUrl } = assertDisposableTestDatabase();
console.log(`Running dictionary search integration on "${databaseName}"`);

const sql = spawnSync(
  'psql',
  [
    testDatabaseUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    resolve(
      process.cwd(),
      'test/database/word-example-integrity.integration.sql',
    ),
  ],
  { stdio: 'inherit' },
);
if (sql.error) throw new Error(`Unable to start psql: ${sql.error.message}`);
if (sql.status !== 0) {
  process.exitCode = sql.status ?? 1;
  throw new Error(`psql exited with ${String(sql.status)}`);
}

async function main(): Promise<void> {
  // assertDisposableTestDatabase() checked that DATABASE_URL is this database.
  const prisma = new PrismaService();
  const service = new DictionaryService(prisma);
  // Letters only, like the e2e run tag, so the tag is a valid pinyin query.
  const tag = String(process.pid).replace(/\d/g, (d) =>
    String.fromCharCode(97 + Number(d)),
  );
  const ids: number[] = [];
  const create = async (pinyin: string, hanzi: string) => {
    const word = await prisma.word.create({
      data: {
        hanzi,
        pinyin,
        pinyinNormalized: normalizePinyin(pinyin),
        status: 'published',
        meanings: {
          create: [{ meaningOrder: 1, meaningEn: `m34a ${pinyin}` }],
        },
      },
      select: { id: true },
    });
    ids.push(word.id);
    return word.id;
  };
  const search = async (q: string) =>
    (await service.search(q)).map((word) => word.id);

  try {
    const exact = await create(`zk${tag} xue`, '鱻一');
    const prefix = await create(`zk${tag} xue sheng`, '鱻二');
    const draft = await prisma.word.create({
      data: {
        hanzi: '鱻三',
        pinyin: `zk${tag} xue xi`,
        pinyinNormalized: normalizePinyin(`zk${tag} xue xi`),
        status: 'draft',
        meanings: { create: [{ meaningOrder: 1, meaningEn: 'm34a draft' }] },
      },
      select: { id: true },
    });
    ids.push(draft.id);

    const cases: Array<[string, string, number[]]> = [
      ['exact before prefix', `zk${tag}xue`, [exact, prefix]],
      ['tone marks', `zk${tag} xué`, [exact, prefix]],
      ['tone numbers', `zk${tag} xue2`, [exact, prefix]],
      ['prefix only', `zk${tag}xues`, [prefix]],
      ['trigram typo', `zk${tag}xueshneg`, [prefix]],
    ];
    for (const [name, query, expected] of cases) {
      const got = await search(query);
      assert.deepEqual(got.slice(0, expected.length), expected, name);
      assert.ok(!got.includes(draft.id), `${name}: draft hidden`);
      console.log(`ok - ${name}`);
    }
    console.log(
      `dictionary search integration: ${cases.length} ranking checks passed`,
    );
  } finally {
    await prisma.word.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
