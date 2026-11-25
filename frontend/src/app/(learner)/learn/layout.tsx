import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { ConsentPendingBanner } from '@/features/legal/consent-form';

import { LearnerSidebar } from '@/features/learner-shell/learner-sidebar';
import { LearnerTabBar } from '@/features/learner-shell/learner-tab-bar';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { CONSENT_DEADLINE_HEADER } from '@/lib/api/learner-session-failure';

/**
 * `.w-app` frame (M2.10a, Q81): from 1024px the sidebar and the page's top
 * bar replace the tab bar. The wrappers have no style below 1024px, so the
 * mobile layout and the lesson screens stay as they are.
 */
export default async function LearnShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  // M1.7b2 B2a: set by the proxy for a `pending` learner (never client-sent).
  const consentDeadline = (await headers()).get(CONSENT_DEADLINE_HEADER);
  return (
    <LearnerToastProvider>
      <div className="w-app">
        <LearnerSidebar />
        <div className="w-main">
          <div className="app">
            {consentDeadline && (
              <ConsentPendingBanner deadline={consentDeadline} />
            )}
            {children}
            <LearnerTabBar />
          </div>
        </div>
      </div>
    </LearnerToastProvider>
  );
}
