import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  ApiClient,
  asArray,
  asNumber,
  asRecord,
  asString,
  PilotImportDependencies,
  PilotImportError,
} from './import-pilot-content';
import {
  importTextbookLesson,
  TextbookImportResult,
} from './import-textbook-content';
import {
  convertTextbookSeeddataEach,
  serializeTextbookLesson,
  TEXTBOOK_COURSE,
  TextbookSeeddataError,
} from './textbook-seeddata.converter';
import type { ExerciseSkips } from './textbook-exercises';
import {
  autoPublishProperNouns,
  countProperNounCandidates,
} from './textbook-proper-noun';

/**
 * M2.13b — whole-grade textbook import (`docs/process/content-pipeline.md`
 * §9): converts every lesson of one grade into `<outRoot>/g<grade>/` and
 * imports them in lesson order. Idempotent: a rerun reuses the course, unit,
 * lessons, topics, words and exercises; a lesson already published is
 * skipped and reported. Stops at the first failing lesson unless
 * `continueOnError`. With `publish` (M2.13b FIX) it then publishes the unit,
 * the course, and each lesson's topics, exercises and lesson revision through
 * the CMS review → publish routes; a lesson with draft words stays draft.
 * FIX-3: draft textbook proper nouns are published first (`textbook-proper-noun.ts`).
 */

export interface TextbookGradeOptions {
  /** The `seeddata/` directory (gitignored; read only by the converter). */
  readonly seeddataRoot: string;
  readonly grade: number;
  readonly outRoot: string;
  readonly dryRun: boolean;
  /** Record a failing lesson and go on (M2.13b FIX). Default: stop. */
  readonly continueOnError?: boolean;
  /**
   * Publish what was imported (M2.13b FIX). Approves only the importer's own
   * draft proper nouns (FIX-3), never any other `Word`.
   */
  readonly publish?: boolean;
}

export type TextbookGradeStatus =
  | 'imported'
  | 'dry_run'
  | 'published'
  | 'skipped_published'
  | 'blocked_draft_words'
  | 'failed';

export interface TextbookGradeLesson {
  readonly fileName: string;
  readonly wordCount: number;
  readonly classroomPhraseCount: number;
  readonly exerciseCount: number;
  readonly exerciseSkips: ExerciseSkips;
  readonly pinyinFixes: number;
  readonly parentheticalStripped: number;
  readonly patternsMoved: number;
  readonly grammarExamplesSkipped: number;
  readonly grammarPointsSkipped: number;
  /** Already published: left untouched, never rewritten by a rerun. */
  readonly skippedPublished: boolean;
  readonly status: TextbookGradeStatus;
  /** Seeddata proper nouns a `--publish` run approves (dry-run: would). */
  readonly properNounCandidates: number;
  /** Proper nouns this run published (FIX-3); always 0 without `--publish`. */
  readonly autoPublishedProperNouns: number;
  /** With `blocked_draft_words`: lesson words not yet published. */
  readonly draftWordCount: number;
  /** With `failed`: the error code only, never content. */
  readonly errorCode: string | null;
  readonly result: TextbookImportResult | null;
}

export interface TextbookGradeSummary {
  readonly grade: number;
  readonly dryRun: boolean;
  readonly lessons: number;
  readonly imported: number;
  readonly published: number;
  readonly skippedPublished: number;
  readonly blockedDraftWords: number;
  readonly failed: number;
  readonly failures: ReadonlyArray<{ fileName: string; errorCode: string }>;
  readonly blocked: ReadonlyArray<{ fileName: string; draftWords: number }>;
  /** Total and per lesson (lessons with at least one). */
  readonly autoPublishedProperNouns: {
    readonly total: number;
    readonly lessons: ReadonlyArray<{ fileName: string; count: number }>;
  };
  readonly properNounCandidates: number;
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

function errorCodeOf(error: unknown): string {
  if (error instanceof PilotImportError) return error.code;
  if (error instanceof TextbookSeeddataError) {
    return [...new Set(error.issues.map((issue) => issue.code))].join(',');
  }
  return error instanceof Error ? error.name : 'unknown';
}

type Approvable = 'topics' | 'exercises' | 'lessons';

/** Review approved (when the latest review is not) then publish one revision. */
async function approveAndPublish(
  api: ApiClient,
  kind: Approvable,
  id: number,
  revisionId: number,
  latestDecision: string | null,
): Promise<void> {
  const base = `/admin/cms/${kind}/${String(id)}/revisions/${String(revisionId)}`;
  if (latestDecision !== 'approved') {
    await api.post(`${base}/reviews`, { decision: 'approved' });
  }
  await api.post(`${base}/publish`, {});
}

function latestOf(row: Record<string, unknown>): {
  id: number;
  decision: string | null;
} {
  const latest = asRecord(row.latestRevision, 'latestRevision');
  const reviews: unknown[] = Array.isArray(latest.reviews)
    ? (latest.reviews as unknown[])
    : [];
  const first = reviews[0];
  return {
    id: asNumber(latest.id, 'latestRevision.id'),
    decision:
      first !== undefined &&
      typeof asRecord(first, 'review').decision === 'string'
        ? (asRecord(first, 'review').decision as string)
        : null,
  };
}

/** The admin behind the token: the audit actor of auto-published names. */
export async function adminActorId(api: ApiClient): Promise<number> {
  const me = asRecord(await api.get('/auth/me'), 'auth/me');
  const user = asRecord(me.user, 'auth/me.user');
  if (user.role !== 'admin') {
    throw new PilotImportError('actor_not_admin', 'Token không phải admin');
  }
  return asNumber(user.id, 'auth/me.user.id');
}

/** Unit first, then course (the course needs a published unit). */
async function publishCourseAndUnit(
  api: ApiClient,
  grade: number,
): Promise<void> {
  const courses = asArray(
    await api.get('/admin/cms/courses?kind=textbook&page=1&limit=100'),
    'courses',
  ).map((row) => asRecord(row, 'courses[]'));
  const course = courses.find((row) => row.code === TEXTBOOK_COURSE.code);
  if (course === undefined) {
    throw new PilotImportError('course_not_found', 'Chưa có khoá để publish');
  }
  const courseId = asNumber(course.id, 'course.id');
  const units = asArray(
    await api.get(
      `/admin/cms/course-units?courseId=${String(courseId)}&page=1&limit=100`,
    ),
    'units',
  ).map((row) => asRecord(row, 'units[]'));
  const unit = units.find(
    (row) => row.gradeNumber === grade && row.volume === null,
  );
  if (unit === undefined) {
    throw new PilotImportError('unit_not_found', 'Chưa có unit để publish');
  }
  if (unit.status !== 'published') {
    await api.post(
      `/admin/cms/course-units/${String(asNumber(unit.id, 'unit.id'))}/publish`,
      {},
    );
  }
  if (course.status !== 'published') {
    await api.post(`/admin/cms/courses/${String(courseId)}/publish`, {});
  }
}

/** Topics → exercises → lesson (CMS publish order, content-pipeline §7 Bước 5). */
async function publishLesson(
  dependencies: PilotImportDependencies,
  api: ApiClient,
  lessonId: number,
): Promise<{
  status: 'published' | 'blocked_draft_words';
  draftWords: number;
}> {
  const draftWords = await dependencies.prisma.lessonWord.count({
    where: {
      lessonId,
      word: { NOT: { status: 'published', deletedAt: null } },
    },
  });
  if (draftWords > 0) return { status: 'blocked_draft_words', draftWords };
  const detail = asRecord(
    await api.get(`/admin/cms/lessons/${String(lessonId)}`),
    'lesson',
  );
  for (const row of asArray(detail.topics, 'topics')) {
    const topic = asRecord(row, 'topics[]');
    if (topic.status !== 'draft' || topic.deletedAt !== null) continue;
    const latest = latestOf(topic);
    await approveAndPublish(
      api,
      'topics',
      asNumber(topic.id, 'topic.id'),
      latest.id,
      latest.decision,
    );
  }
  const exercises = asArray(
    await api.get(
      `/admin/cms/exercises?lessonId=${String(lessonId)}&page=1&limit=100`,
    ),
    'exercises',
  ).map((row) => asRecord(row, 'exercises[]'));
  for (const exercise of exercises) {
    if (exercise.status !== 'draft' || exercise.deletedAt !== null) continue;
    const latest = latestOf(exercise);
    await approveAndPublish(
      api,
      'exercises',
      asNumber(exercise.id, 'exercise.id'),
      latest.id,
      latest.decision,
    );
  }
  const revisions = asArray(detail.revisions, 'lesson.revisions').map((row) =>
    asRecord(row, 'lesson.revisions[]'),
  );
  const latest = revisions.reduce<Record<string, unknown> | null>(
    (best, row) =>
      best === null ||
      asNumber(row.revision, 'revision') > asNumber(best.revision, 'revision')
        ? row
        : best,
    null,
  );
  if (latest === null) {
    throw new PilotImportError(
      'lesson_revision_missing',
      'Bài chưa có revision',
    );
  }
  // Reviews come newest first (cms.service.ts REVISION_SELECT).
  const reviews: unknown[] = Array.isArray(latest.reviews)
    ? (latest.reviews as unknown[])
    : [];
  const decision =
    reviews.length > 0
      ? asString(asRecord(reviews[0], 'review').decision, 'review.decision')
      : null;
  await approveAndPublish(
    api,
    'lessons',
    lessonId,
    asNumber(latest.id, 'revision.id'),
    decision,
  );
  return { status: 'published', draftWords: 0 };
}

export async function importTextbookGrade(
  dependencies: PilotImportDependencies,
  options: TextbookGradeOptions,
): Promise<TextbookGradeLesson[]> {
  const log = dependencies.logger ?? (() => undefined);
  const paths = textbookSeeddataPaths(options.seeddataRoot, options.grade);
  const { files, failures } = convertTextbookSeeddataEach({
    vocab: readJson(paths.vocab, 'từ vựng'),
    lessons: readJson(paths.lessons, 'bài học'),
    grade: options.grade,
    from: 1,
  });
  if (failures.length > 0 && options.continueOnError !== true) {
    throw new TextbookSeeddataError(failures.flatMap((f) => f.issues));
  }
  const outDir = join(options.outRoot, `g${String(options.grade)}`);
  mkdirSync(outDir, { recursive: true });
  // Only our own lesson files: a smaller rerun must not leave stale lessons.
  for (const name of readdirSync(outDir)) {
    if (/^lesson-\d{2}\.json$/u.test(name)) rmSync(join(outDir, name));
  }
  for (const { fileName, content } of files) {
    writeFileSync(join(outDir, fileName), serializeTextbookLesson(content));
  }
  const api = new ApiClient(dependencies, log);
  const lessons: TextbookGradeLesson[] = failures.map((failure) => ({
    fileName: `lesson-${String(failure.bai).padStart(2, '0')}.json`,
    wordCount: 0,
    classroomPhraseCount: 0,
    exerciseCount: 0,
    exerciseSkips: { mcqMeaning: 0, mcqHanzi: 0, duplicateWords: 0 },
    pinyinFixes: 0,
    parentheticalStripped: 0,
    patternsMoved: 0,
    properNounCandidates: 0,
    autoPublishedProperNouns: 0,
    grammarExamplesSkipped: 0,
    grammarPointsSkipped: 0,
    skippedPublished: false,
    status: 'failed',
    draftWordCount: 0,
    errorCode: [...new Set(failure.issues.map((issue) => issue.code))].join(
      ',',
    ),
    result: null,
  }));
  let coursePublished = false;
  const publishing = options.publish === true && !options.dryRun;
  const actorId = publishing ? await adminActorId(api) : null;
  for (const { fileName, content } of files) {
    const summary = {
      fileName,
      wordCount: content.words.length,
      classroomPhraseCount: content.classroomPhrases.length,
      exerciseCount: content.exercises.length,
      exerciseSkips: content.exerciseSkips,
      pinyinFixes: content.pinyinFixes,
      parentheticalStripped: content.parentheticalStripped,
      patternsMoved: content.patternsMoved,
      grammarExamplesSkipped: content.grammarExamplesSkipped,
      grammarPointsSkipped: content.grammarPointsSkipped,
      properNounCandidates: await countProperNounCandidates(
        dependencies.prisma,
        content.words,
      ),
      autoPublishedProperNouns: 0,
      draftWordCount: 0,
      errorCode: null,
    };
    const existing = await dependencies.prisma.lesson.findFirst({
      where: { slug: content.lesson.slug },
      select: { status: true, deletedAt: true },
    });
    if (existing?.status === 'published' && existing.deletedAt === null) {
      log(`${fileName}: đã published, bỏ qua`);
      lessons.push({
        ...summary,
        skippedPublished: true,
        status: 'skipped_published',
        result: null,
      });
      continue;
    }
    try {
      const result = await importTextbookLesson(dependencies, {
        filePath: join(outDir, fileName),
        dryRun: options.dryRun,
      });
      let status: TextbookGradeStatus = options.dryRun ? 'dry_run' : 'imported';
      let draftWordCount = 0;
      let autoPublished = 0;
      if (publishing && actorId !== null && result.lessonId !== null) {
        if (!coursePublished) {
          await publishCourseAndUnit(api, options.grade);
          coursePublished = true;
        }
        // Before the draft-word check, so names do not block the lesson.
        autoPublished = await autoPublishProperNouns(dependencies.prisma, {
          lessonId: result.lessonId,
          words: content.words,
          actorId,
          publish: true,
        });
        const published = await publishLesson(
          dependencies,
          api,
          result.lessonId,
        );
        status = published.status;
        draftWordCount = published.draftWords;
      }
      log(`${fileName}: ${status}`);
      lessons.push({
        ...summary,
        skippedPublished: false,
        status,
        draftWordCount,
        autoPublishedProperNouns: autoPublished,
        result,
      });
    } catch (error) {
      if (options.continueOnError !== true) throw error;
      const errorCode = errorCodeOf(error);
      log(`${fileName}: failed ${errorCode}`);
      lessons.push({
        ...summary,
        skippedPublished: false,
        status: 'failed',
        errorCode,
        result: null,
      });
    }
  }
  return lessons.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** Counts only, never lesson content. */
export function summarizeTextbookGrade(
  grade: number,
  dryRun: boolean,
  lessons: readonly TextbookGradeLesson[],
): TextbookGradeSummary {
  const count = (status: TextbookGradeStatus) =>
    lessons.filter((lesson) => lesson.status === status).length;
  return {
    grade,
    dryRun,
    lessons: lessons.length,
    imported:
      count('imported') +
      count('dry_run') +
      count('published') +
      count('blocked_draft_words'),
    published: count('published'),
    skippedPublished: count('skipped_published'),
    blockedDraftWords: count('blocked_draft_words'),
    failed: count('failed'),
    failures: lessons
      .filter((lesson) => lesson.status === 'failed')
      .map((lesson) => ({
        fileName: lesson.fileName,
        errorCode: lesson.errorCode ?? 'unknown',
      })),
    blocked: lessons
      .filter((lesson) => lesson.status === 'blocked_draft_words')
      .map((lesson) => ({
        fileName: lesson.fileName,
        draftWords: lesson.draftWordCount,
      })),
    autoPublishedProperNouns: {
      total: lessons.reduce((sum, l) => sum + l.autoPublishedProperNouns, 0),
      lessons: lessons
        .filter((lesson) => lesson.autoPublishedProperNouns > 0)
        .map((lesson) => ({
          fileName: lesson.fileName,
          count: lesson.autoPublishedProperNouns,
        })),
    },
    properNounCandidates: lessons.reduce(
      (sum, lesson) => sum + lesson.properNounCandidates,
      0,
    ),
  };
}
