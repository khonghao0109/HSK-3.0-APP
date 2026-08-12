import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import './styles.css';

export const metadata: Metadata = {
  title: {
    default: 'HSK Content Workbench',
    template: '%s · HSK Content Workbench',
  },
  description: 'Operational content console for the HSK 3.0 learning platform.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Per-request CSP nonces require request-time rendering so Next.js can
  // propagate the nonce to framework and page scripts.
  await connection();

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
