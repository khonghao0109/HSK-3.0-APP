import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { ReviewOverviewView } from '@/features/learner-review/review-overview';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';

import './review-overview.css';

export const metadata: Metadata = {
  title: 'Ôn tập',
};

/** Ôn tập (M3.3b, Q270): the island reads `/api/learner/review/overview`. */
export default async function ReviewPage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');
  return (
    <>
      <LearnerWebTopbar />
      <ReviewOverviewView />
    </>
  );
}
