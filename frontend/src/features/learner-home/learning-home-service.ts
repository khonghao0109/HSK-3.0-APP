import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  backendLearningHomeSchema,
  type LearningHome,
} from './learning-home-contract';

export async function getLearningHome(token: string): Promise<LearningHome> {
  const response = await backend.request('/api/v1/learning/home', { token });
  return backendLearningHomeSchema.parse(response).data;
}
