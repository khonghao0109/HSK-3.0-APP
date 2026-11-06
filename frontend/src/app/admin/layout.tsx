import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { adminFontClassNames } from '@/features/admin-shell/admin-fonts';
import { AdminShell } from '@/features/admin-shell/admin-shell';
import { getServerAdminSession } from '@/features/auth/server-session';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';

import './admin.css';

export const metadata: Metadata = {
  title: {
    default: 'Hán Lộ Admin',
    template: '%s · Hán Lộ Admin',
  },
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerAdminSession();
  if (session.state === 'unauthenticated') redirectToSessionLogin();
  if (session.state === 'forbidden') redirect('/forbidden');
  return (
    <div className={['admin-app', ...adminFontClassNames].join(' ')}>
      <AdminShell user={session.user}>{children}</AdminShell>
    </div>
  );
}
