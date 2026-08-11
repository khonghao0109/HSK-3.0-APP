import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/features/admin-shell/admin-shell';
import { getServerAdminSession } from '@/features/auth/server-session';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerAdminSession();
  if (session.state === 'unauthenticated') redirect('/api/session/logout');
  if (session.state === 'forbidden') redirect('/forbidden');
  return <AdminShell user={session.user}>{children}</AdminShell>;
}
