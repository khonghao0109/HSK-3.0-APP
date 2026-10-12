import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { DictionarySearchItem } from '@/features/learner-dictionary/dictionary-contract';
import { normalizeSearchQuery } from '@/features/learner-dictionary/dictionary-display';
import { DictionarySearch } from '@/features/learner-dictionary/dictionary-search';
import { searchWords } from '@/features/learner-dictionary/dictionary-service';
import { isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Từ điển',
};

/**
 * Tra từ (M2.6b). Only a learner session is needed: no onboarding check,
 * whose route keeps the default 20/minute limit. `?q=` is searched here so a
 * reload or a back navigation shows its results at once.
 */
export default async function DictionaryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  const q = normalizeSearchQuery((await searchParams).q);
  let items: DictionarySearchItem[] | null = null;
  let authFailed = false;
  if (q !== null) {
    try {
      items = await searchWords(session.token, q);
    } catch (error) {
      // Any other failure shows the retry state of the list.
      if (isAuthFailure(error)) authFailed = true;
    }
  }
  if (authFailed) redirect('/sign-in');

  return <DictionarySearch initialQuery={q ?? ''} initialItems={items} />;
}
