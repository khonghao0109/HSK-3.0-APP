import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { parseServerEnv } from '@/lib/config/env-schema';

import {
  backendDictionarySavedSchema,
  backendDictionarySearchSchema,
  backendDictionaryWordSchema,
  type DictionarySearchItem,
  type DictionaryWordDetail,
} from './dictionary-contract';
import type { DictionaryHandlerDependencies } from './dictionary-route-handler';

// The token is always sent, also to the public routes: the backend then counts
// the 120/minute read limit per learner instead of per shared IP.

export function searchPath(q: string): string {
  return `/api/v1/dictionary?query=${encodeURIComponent(q)}`;
}

export async function searchWords(
  token: string,
  q: string,
): Promise<DictionarySearchItem[]> {
  const response = await backend.request(searchPath(q), { token });
  return backendDictionarySearchSchema.parse(response).data;
}

export async function getWord(
  token: string,
  id: number,
): Promise<DictionaryWordDetail> {
  const response = await backend.request(`/api/v1/dictionary/words/${id}`, {
    token,
  });
  return backendDictionaryWordSchema.parse(response).data;
}

export async function getSaved(token: string, id: number): Promise<boolean> {
  const response = await backend.request(
    `/api/v1/dictionary/words/${id}/save`,
    { token },
  );
  return backendDictionarySavedSchema.parse(response).data.saved;
}

export function dictionaryDependencies(): DictionaryHandlerDependencies {
  const serverEnv = parseServerEnv();
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    learnerCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    requestBackend: (path, options) => backend.request(path, options),
  };
}
