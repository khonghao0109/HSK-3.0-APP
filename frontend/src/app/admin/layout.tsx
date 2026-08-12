import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/features/admin-shell/admin-shell';
import { getServerAdminSession } from '@/features/auth/server-session';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerAdminSession();
  if (session.state === 'unauthenticated') redirectToSessionLogin();
  if (session.state === 'forbidden') redirect('/forbidden');
  return <AdminShell user={session.user}>{children}</AdminShell>;
}
