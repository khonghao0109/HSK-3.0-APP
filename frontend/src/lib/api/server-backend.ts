import 'server-only';

import { headers } from 'next/headers';

import {
  clientForwardedFor,
  createBackendClient,
} from '@/lib/api/backend-client';
import { serverEnv } from '@/lib/config/server-env';

export const backend = createBackendClient({
  baseUrl: serverEnv.BACKEND_API_URL,
  timeoutMs: serverEnv.BFF_REQUEST_TIMEOUT_MS,
  // Every caller runs in a route handler or dynamic server component, so the
  // incoming request headers are available.
  forwardedFor: async () => clientForwardedFor(await headers()),
});
