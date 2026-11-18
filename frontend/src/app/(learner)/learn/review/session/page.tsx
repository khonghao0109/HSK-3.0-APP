import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { ReviewSession } from '@/features/learner-review/review-session';

export const metadata: Metadata = {
  title: 'Ôn tập',
};

/**
 * Phiên ôn flashcard (M3.3a, Q258). Reached by URL only until Pha B adds the
 * nav entry. The island loads or creates the session through the BFF.
 */
export default async function ReviewSessionPage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');
  return <ReviewSession />;
}
