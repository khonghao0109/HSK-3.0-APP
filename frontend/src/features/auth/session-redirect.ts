import 'server-only';

import { redirect } from 'next/navigation';

import { serverEnv } from '@/lib/config/server-env';

import { buildSessionLoginUrl } from './session-navigation';

export function redirectToSessionLogin(): never {
  redirect(buildSessionLoginUrl(serverEnv.APP_ORIGIN));
}
