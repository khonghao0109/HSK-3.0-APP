import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

import {
  convertTextbookSeeddata,
  serializeTextbookLesson,
  TextbookSeeddataError,
} from '../../src/modules/content-pilot/textbook-seeddata.converter';

/**
 * M2.13a — `docs/process/content-pipeline.md` §9.
 *
 *   npm run content:textbook:convert -- --vocab <file> --lessons <file> \
 *     --grade 1 --from 1 --to 3 --out /tmp/hsk-textbook
 *
 * Reads seeddata only; never echoes its text. Prints file names, counts and
 * SHA-256 of each output. `--out` must be outside the repository so generated
 * files are never committed.
 */

interface Options {
  vocab: string;
  lessons: string;
  grade: number;
  from: number;
  to: number;
  out: string;
}

function usage(): never {
  console.error(
    'Cách dùng: npm run content:textbook:convert -- --vocab <file> --lessons <file> --grade <n> --from <n> --to <n> --out <dir ngoài repo>',
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !['--vocab', '--lessons', '--grade', '--from', '--to', '--out'].includes(
        key,
      ) ||
      value === undefined ||
      value.startsWith('--') ||
      values.has(key)
    ) {
      usage();
    }
    values.set(key, value);
  }
  const int = (key: string): number => {
    const value = Number(values.get(key));
    if (!Number.isSafeInteger(value) || value < 1) usage();
    return value;
  };
  const path = (key: string): string => {
    const value = values.get(key);
    if (value === undefined) usage();
    return resolve(process.cwd(), value);
  };
  const options = {
    vocab: path('--vocab'),
    lessons: path('--lessons'),
    grade: int('--grade'),
    from: int('--from'),
    to: int('--to'),
    out: path('--out'),
  };
  if (options.grade > 9 || options.from > options.to) usage();
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(__dirname, '..', '..', '..');
  const inside = relative(repoRoot, options.out);
  if (!inside.startsWith('..') && !isAbsolute(inside)) {
    console.error(`--out phải nằm ngoài repo (${repoRoot}).`);
    process.exit(2);
  }
  const files = convertTextbookSeeddata({
    vocab: JSON.parse(readFileSync(options.vocab, 'utf8')) as unknown,
    lessons: JSON.parse(readFileSync(options.lessons, 'utf8')) as unknown,
    grade: options.grade,
    from: options.from,
    to: options.to,
  });
  mkdirSync(options.out, { recursive: true });
  for (const { fileName, content } of files) {
    const text = serializeTextbookLesson(content);
    writeFileSync(join(options.out, fileName), text, 'utf8');
    const sha = createHash('sha256').update(text).digest('hex');
    const lines = content.topics
      .filter((topic) => topic.key === 'key_text')
      .flatMap((topic) => topic.content)
      .reduce(
        (count, block) =>
          count + (block.type === 'dialogue' ? block.lines.length : 1),
        0,
      );
    const grammar =
      content.topics.find((topic) => topic.key === 'grammar')?.content.length ??
      0;
    console.log(
      `${fileName} sha256=${sha} words=${String(content.words.length)} keyTextLines=${String(lines)} grammar=${String(grammar)}`,
    );
  }
}

try {
  main();
} catch (error) {
  if (error instanceof TextbookSeeddataError) {
    console.error(`FAIL ${error.message}`);
  } else if (error instanceof SyntaxError) {
    console.error('FAIL JSON không parse được (không in nội dung).');
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
