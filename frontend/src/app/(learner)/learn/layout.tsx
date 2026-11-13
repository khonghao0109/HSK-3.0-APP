import type { ReactNode } from 'react';

import { LearnerSidebar } from '@/features/learner-shell/learner-sidebar';
import { LearnerTabBar } from '@/features/learner-shell/learner-tab-bar';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

/**
 * `.w-app` frame (M2.10a, Q81): from 1024px the sidebar and the page's top
 * bar replace the tab bar. The wrappers have no style below 1024px, so the
 * mobile layout and the lesson screens stay as they are.
 */
export default function LearnShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <LearnerToastProvider>
      <div className="w-app">
        <LearnerSidebar />
        <div className="w-main">
          <div className="app">
            {children}
            <LearnerTabBar />
          </div>
        </div>
      </div>
    </LearnerToastProvider>
  );
}
