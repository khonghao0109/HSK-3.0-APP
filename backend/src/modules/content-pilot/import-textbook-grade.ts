import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  PilotImportDependencies,
  PilotImportError,
} from './import-pilot-content';
import {
  importTextbookLesson,
  TextbookImportResult,
} from './import-textbook-content';
import {
  convertTextbookSeeddata,
  serializeTextbookLesson,
} from './textbook-seeddata.converter';
import type { ExerciseSkips } from './textbook-exercises';

/**
 * M2.13b — whole-grade textbook import (`docs/process/content-pipeline.md`
 * §9): converts every lesson of one grade into `<outRoot>/g<grade>/` and
 * imports them in lesson order. Idempotent: a rerun reuses the course, unit,
 * lessons, topics, words and exercises; a lesson already published is
 * skipped and reported. Stops at the first failing lesson.
 */

export interface TextbookGradeOptions {
  /** The `seeddata/` directory (gitignored; read only by the converter). */
  readonly seeddataRoot: string;
  readonly grade: number;
  readonly outRoot: string;
  readonly dryRun: boolean;
}

export interface TextbookGradeLesson {
  readonly fileName: string;
  readonly wordCount: number;
  readonly classroomPhraseCount: number;
  readonly exerciseCount: number;
  readonly exerciseSkips: ExerciseSkips;
  /** Already published: left untouched, never rewritten by a rerun. */
  readonly skippedPublished: boolean;
  readonly result: TextbookImportResult | null;
}

export function textbookSeeddataPaths(
  seeddataRoot: string,
  grade: number,
): { vocab: string; lessons: string } {
  const base = join(seeddataRoot, 'TuVung_nguphap_baikhoa');
  const g = String(grade);
  return {
    vocab: join(base, `HSK${g}_TuVung`, `HSK${g}_TuVung.json`),
    lessons: join(base, `HSK${g}`, `HSK${g}_data.json`),
  };
}

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new PilotImportError(
      'seeddata_missing',
      `Không có file ${what}: ${path}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Never echo seeddata content.
    throw new PilotImportError(
      'seeddata_json',
      `File ${what} không parse được`,
    );
  }
}

export async function importTextbookGrade(
  dependencies: PilotImportDependencies,
  options: TextbookGradeOptions,
): Promise<TextbookGradeLesson[]> {
  const log = dependencies.logger ?? (() => undefined);
  const paths = textbookSeeddataPaths(options.seeddataRoot, options.grade);
  const files = convertTextbookSeeddata({
    vocab: readJson(paths.vocab, 'từ vựng'),
    lessons: readJson(paths.lessons, 'bài học'),
    grade: options.grade,
    from: 1,
  });
  const outDir = join(options.outRoot, `g${String(options.grade)}`);
  mkdirSync(outDir, { recursive: true });
  // Only our own lesson files: a smaller rerun must not leave stale lessons.
  for (const name of readdirSync(outDir)) {
    if (/^lesson-\d{2}\.json$/u.test(name)) rmSync(join(outDir, name));
  }
  for (const { fileName, content } of files) {
    writeFileSync(join(outDir, fileName), serializeTextbookLesson(content));
  }
  const lessons: TextbookGradeLesson[] = [];
  for (const { fileName, content } of files) {
    const existing = await dependencies.prisma.lesson.findFirst({
      where: { slug: content.lesson.slug },
      select: { status: true, deletedAt: true },
    });
    const summary = {
      fileName,
      wordCount: content.words.length,
      classroomPhraseCount: content.classroomPhrases.length,
      exerciseCount: content.exercises.length,
      exerciseSkips: content.exerciseSkips,
    };
    if (existing?.status === 'published' && existing.deletedAt === null) {
      log(`${fileName}: đã published, bỏ qua`);
      lessons.push({ ...summary, skippedPublished: true, result: null });
      continue;
    }
    const result = await importTextbookLesson(dependencies, {
      filePath: join(outDir, fileName),
      dryRun: options.dryRun,
    });
    log(
      `${fileName}: words=${String(content.words.length)} classroom=${String(
        content.classroomPhrases.length,
      )} exercises=${String(content.exercises.length)} draftWords=${String(
        result.draftWords.length,
      )}`,
    );
    lessons.push({ ...summary, skippedPublished: false, result });
  }
  return lessons;
}
