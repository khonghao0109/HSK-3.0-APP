import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './styles.css';

export const metadata: Metadata = {
  title: {
    default: 'HSK Content Workbench',
    template: '%s · HSK Content Workbench',
  },
  description: 'Operational content console for the HSK 3.0 learning platform.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
