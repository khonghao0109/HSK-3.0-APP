import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  allVietnamese,
  displayPinyin,
} from '@/features/learner-dictionary/dictionary-display';
import {
  getSaved,
  getWord,
} from '@/features/learner-dictionary/dictionary-service';
import {
  WordDetail,
  type WordView,
} from '@/features/learner-dictionary/word-detail';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
import { parseLessonId } from '@/features/learner-lesson/lesson-sections';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Chi tiết từ vựng',
};

/**
 * Chi tiết từ (M2.6b). A bad id or a backend 404 (missing or unpublished
 * word) is `notFound()`; no session or a 401/403 goes to `/sign-in`. Both run
 * before anything renders: the segment has no `loading.tsx` or Suspense, so
 * the response keeps its real 404 / 307 status.
 */
export default async function WordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = parseLessonId((await params).id);
  if (id === null) notFound();

  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let view: WordView | null = null;
  let saved = false;
  let authFailed = false;
  try {
    const [word, isSaved] = await Promise.all([
      getWord(session.token, id),
      getSaved(session.token, id),
    ]);
    const source = word.sources[0];
    view = {
      id: word.id,
      hanzi: word.hanzi,
      traditional:
        word.traditional !== null && word.traditional !== word.hanzi
          ? word.traditional
          : null,
      pinyin: displayPinyin(word),
      vietnamese: allVietnamese(word.meanings),
      level: word.levels[0]?.name ?? null,
      example: word.example,
      source: source ? { name: source.name, version: source.version } : null,
    };
    saved = isSaved;
  } catch (error) {
    if (isAuthFailure(error)) authFailed = true;
    else if (!(error instanceof BackendRequestError && error.status === 404)) {
      throw error;
    }
  }

  if (authFailed) redirect('/sign-in');
  if (view === null) notFound();
  return (
    <>
      <LearnerWebTopbar />
      <WordDetail word={view} initialSaved={saved} />
    </>
  );
}
