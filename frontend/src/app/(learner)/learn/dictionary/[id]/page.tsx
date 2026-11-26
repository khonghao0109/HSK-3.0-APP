import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  allVietnamese,
  displayPinyin,
  firstVietnamese,
  vietnameseMeanings,
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
import { redirectIfConsentRequired } from '@/lib/api/learner-session-failure';

const TITLE = 'Chi tiết từ vựng';

// Q331: the title and the page read the session and the word once per request.
const readSession = cache(getServerLearnerSession);
const readWord = cache(getWord);

/** C9: "学习 · Chi tiết từ vựng · Hán Lộ"; the page itself handles failures. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = parseLessonId((await params).id);
  if (id === null) return { title: TITLE };
  try {
    const session = await readSession();
    if (session.state !== 'learner' || !session.token) return { title: TITLE };
    const word = await readWord(session.token, id);
    return { title: `${word.hanzi} · ${TITLE}` };
  } catch {
    return { title: TITLE };
  }
}

function uniqueSources(
  sources: readonly { name: string; version: string }[],
): { name: string; version: string }[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = JSON.stringify([source.name, source.version]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

  const session = await readSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let view: WordView | null = null;
  let saved = false;
  let authFailed = false;
  try {
    const [word, isSaved] = await Promise.all([
      readWord(session.token, id),
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
      meanings: vietnameseMeanings(word.meanings),
      level: word.levels[0]?.name ?? null,
      // M2.13c2: id only; the bytes come through the learner media grant.
      audio: word.audio ? { mediaId: word.audio.mediaId } : null,
      source: source ? { name: source.name, version: source.version } : null,
      // Q311: the old single Word.example only when the API has no examples.
      ...(word.examples.length > 0
        ? {
            examples: word.examples.map((example) => ({
              hanzi: example.hanzi,
              // Q315: Vietnamese only; pinyin and English stay hidden.
              vi: example.vi?.trim() || null,
            })),
            exampleSources: uniqueSources(
              word.examples.map((example) => example.source),
            ),
          }
        : {
            examples: word.example ? [{ hanzi: word.example, vi: null }] : [],
            exampleSources: source
              ? [{ name: source.name, version: source.version }]
              : [],
          }),
      related: word.related.map((item) => ({
        id: item.id,
        hanzi: item.hanzi,
        pinyin: displayPinyin(item),
        vietnamese: firstVietnamese(item.meanings),
        level: item.level,
      })),
    };
    saved = isSaved;
  } catch (error) {
    redirectIfConsentRequired(error, `/learn/dictionary/${id}`);
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
