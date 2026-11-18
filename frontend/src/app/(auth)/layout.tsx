import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { adminFontClassNames } from '@/features/admin-shell/admin-fonts';
import { AdminIconSprite } from '@/features/admin-shell/admin-icon-sprite';

import '../admin/admin.css';

export const metadata: Metadata = {
  title: {
    default: 'Hán Lộ Admin',
    template: '%s · Hán Lộ Admin',
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={['admin-app', ...adminFontClassNames].join(' ')}>
      <AdminIconSprite />
      {children}
    </div>
  );
}
