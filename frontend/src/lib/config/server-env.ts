import 'server-only';

import { parseServerEnv, type ServerEnv } from './env-schema';

export type { ServerEnv };
export const serverEnv = parseServerEnv(process.env);
