import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  backendLearningPathSchema,
  type LearningPath,
} from './learning-path-contract';

export async function getLearningPath(token: string): Promise<LearningPath> {
  const response = await backend.request('/api/v1/learning/path', { token });
  return backendLearningPathSchema.parse(response).data;
}
