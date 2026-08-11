import 'server-only';

import { createBackendClient } from '@/lib/api/backend-client';
import { serverEnv } from '@/lib/config/server-env';

export const backend = createBackendClient({
  baseUrl: serverEnv.BACKEND_API_URL,
  timeoutMs: serverEnv.BFF_REQUEST_TIMEOUT_MS,
});
