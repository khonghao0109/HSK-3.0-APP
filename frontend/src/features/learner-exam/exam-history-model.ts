import type { components } from '@/lib/api/backend-generated-types';
import { levelLabel } from '@/features/learner-home/level-label';

import { decodeExamLevelCode, first, positiveInteger } from './exam-list-query';
import { formatExamDate } from './exam-result-model';

/**
 * M4.5 B3: pure rules of the learner exam history page. The page only reads
 * `GET /exam/attempts`; it never calls the result route, so listing history
 * cannot grade an attempt ahead of time.
 */
export type ExamHistoryItem = components['schemas']['ExamHistoryItemDto'];

export const EXAM_HISTORY_PATH = '/learn/exam/history';
export const EXAM_HISTORY_PAGE_LIMIT = 20;

const NO_VALUE = '—';

export type ExamHistoryQueryState = {
  levelCode: string | null;
  page: number;
};

export type ExamHistoryStatusTone =
  'success' | 'danger' | 'neutral' | 'pending';

export type ExamHistoryRow = {
  attemptId: number;
  href: string;
  title: string;
  date: string;
  score: string;
  maxScore: string | null;
  listening: string;
  reading: string;
  writing: string;
  statusLabel: string;
  statusTone: ExamHistoryStatusTone;
};

function skillScore(
  item: ExamHistoryItem,
  skill: ExamHistoryItem['skills'][number]['skill'],
): string {
  const found = item.skills.find((entry) => entry.skill === skill);
  return found === undefined ? NO_VALUE : String(found.score);
}

function status(item: ExamHistoryItem): {
  label: string;
  tone: ExamHistoryStatusTone;
} {
  if (item.score === null) return { label: 'Đang chấm', tone: 'pending' };
  if (item.passed === true) return { label: 'Đạt', tone: 'success' };
  if (item.passed === false) return { label: 'Chưa đạt', tone: 'danger' };
  return { label: NO_VALUE, tone: 'neutral' };
}

export function toExamHistoryRow(item: ExamHistoryItem): ExamHistoryRow {
  const { label, tone } = status(item);
  return {
    attemptId: item.attemptId,
    href: `/learn/exam/attempts/${String(item.attemptId)}/result`,
    title: item.testTitle,
    date: formatExamDate(item.finishedAt),
    score: item.score === null ? NO_VALUE : String(item.score),
    maxScore: item.maxScore === null ? null : String(item.maxScore),
    listening: skillScore(item, 'listening'),
    reading: skillScore(item, 'reading'),
    writing: skillScore(item, 'writing'),
    statusLabel: label,
    statusTone: tone,
  };
}

/**
 * The mockup's closing note, only when it is true of everything the learner is
 * looking at: one level, one frozen threshold and maximum, and no attempt
 * hidden on another page.
 */
export function examHistoryPassNote(
  items: readonly ExamHistoryItem[],
  total: number,
): string | null {
  const firstItem = items[0];
  if (firstItem === undefined || items.length !== total) return null;
  const { levelCode, passScore } = firstItem;
  if (passScore === null) return null;
  const maxScores = new Set(
    items.flatMap((item) => (item.maxScore === null ? [] : [item.maxScore])),
  );
  const [maxScore] = maxScores;
  if (maxScores.size !== 1 || maxScore === undefined) return null;
  const sameThreshold = items.every(
    (item) => item.levelCode === levelCode && item.passScore === passScore,
  );
  if (!sameThreshold) return null;
  return `Điểm đạt ${levelLabel(levelCode)} là từ ${String(passScore)}/${String(maxScore)}.`;
}

export function parseExamHistoryQuery(
  input: Record<string, string | string[] | undefined>,
): ExamHistoryQueryState {
  return {
    levelCode: decodeExamLevelCode(first(input.levelCode)) ?? null,
    page: positiveInteger(first(input.page)) ?? 1,
  };
}

export function examHistoryHref(state: ExamHistoryQueryState): string {
  const params = new URLSearchParams();
  if (state.levelCode) params.set('levelCode', state.levelCode);
  if (state.page > 1) params.set('page', String(state.page));
  const search = params.toString();
  return search ? `${EXAM_HISTORY_PATH}?${search}` : EXAM_HISTORY_PATH;
}
