import type { ReactNode } from 'react';

import { LearnerTabBar } from '@/features/learner-shell/learner-tab-bar';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

export default function LearnShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <LearnerToastProvider>
      <div className="app">
        {children}
        <LearnerTabBar />
      </div>
    </LearnerToastProvider>
  );
}
