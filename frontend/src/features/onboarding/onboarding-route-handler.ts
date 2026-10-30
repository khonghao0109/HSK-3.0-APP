import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiFailureKind } from '@/lib/api/api-error';
import {
  isSameOrigin,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';

import {
  levelsResponseSchema,
  onboardingCompleteInputSchema,
  onboardingStatusResponseSchema,
  userGoalSchema,
  type LevelItem,
} from './onboarding-contract';
import { resolveLevelForBand } from './onboarding-values';

const goalCreatedResponseSchema = z.object({
  success: z.literal(true),
  data: userGoalSchema,
});

const learningPlanCreatedResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ id: z.number().int() }).passthrough(),
});

export type OnboardingHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: <T = unknown>(
    path: string,
    options?: {
      token?: string;
      method?: 'GET' | 'POST';
      body?: unknown;
    },
  ) => Promise<T>;
};

function errorResponse(
  status: number,
  kind: ApiFailureKind,
  message: string,
): NextResponse {
  const response = NextResponse.json(
    {
      success: false,
      error: {
        kind,
        message,
      },
    },
    { status },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function handleAuthError(
  status: number,
  deps: Pick<OnboardingHandlerDependencies, 'learnerCookieName' | 'production'>,
): NextResponse {
  const response = safeResponse(status);
  setClearedCookies(response, {
    cookieName: deps.learnerCookieName,
    production: deps.production,
  });
  return response;
}

function handleBackendError(
  error: unknown,
  deps: Pick<OnboardingHandlerDependencies, 'learnerCookieName' | 'production'>,
): NextResponse {
  const status = statusFromError(error);
  if (status === 401 || status === 403) {
    return handleAuthError(status, deps);
  }
  if (status === 400) {
    return safeResponse(400);
  }
  if (status === 429) {
    return safeResponse(429);
  }
  return safeResponse(503);
}

export async function handleOnboardingComplete(
  request: NextRequest,
  deps: OnboardingHandlerDependencies,
): Promise<NextResponse> {
  // 1. isSameOrigin check
  if (!isSameOrigin(request, deps.appOrigin)) {
    return safeResponse(403);
  }

  // 2. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }

  // 3. Schema validation
  const parsed = onboardingCompleteInputSchema.safeParse(body);
  if (!parsed.success) {
    return safeResponse(400);
  }
  const input = parsed.data;

  // 4. Check learner cookie (only learner cookie, not admin cookie)
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) {
    return safeResponse(401);
  }

  // 5. GET /api/v1/levels -> resolveLevelForBand
  let levels: LevelItem[];
  try {
    const rawLevels = await deps.requestBackend('/api/v1/levels', { token });
    levels = levelsResponseSchema.parse(rawLevels).data;
  } catch (error) {
    return handleBackendError(error, deps);
  }

  const level = resolveLevelForBand(levels, input.targetBand);
  if (!level) {
    return errorResponse(
      409,
      'level_unavailable',
      'The selected level is unavailable.',
    );
  }

  // 6. POST /api/v1/onboarding/goals
  const goalPayload: {
    targetLevelId: number;
    targetBand: number;
    dailyMinutes: number;
    learningPurpose: string;
    reminderEnabled: boolean;
    startDate: string;
    reminderTime?: string;
  } = {
    targetLevelId: level.id,
    targetBand: input.targetBand,
    dailyMinutes: input.dailyMinutes,
    learningPurpose: input.learningPurpose,
    reminderEnabled: input.reminderEnabled,
    startDate: input.startDate,
  };
  if (input.reminderEnabled && input.reminderTime !== null) {
    goalPayload.reminderTime = input.reminderTime;
  }

  let rawGoal: unknown;
  try {
    rawGoal = await deps.requestBackend('/api/v1/onboarding/goals', {
      token,
      method: 'POST',
      body: goalPayload,
    });
  } catch (error) {
    const status = statusFromError(error);
    if (status === 404) {
      return errorResponse(
        409,
        'level_unavailable',
        'The selected level is unavailable.',
      );
    }
    if (status === 409) {
      return safeResponse(409);
    }
    return handleBackendError(error, deps);
  }
  // A malformed or empty success envelope is an upstream fault, never a
  // client error: keep it out of the status mapping above.
  if (!goalCreatedResponseSchema.safeParse(rawGoal).success) {
    return safeResponse(503);
  }

  // 7. POST /api/v1/learning-plans
  let rawPlan: unknown;
  try {
    rawPlan = await deps.requestBackend('/api/v1/learning-plans', {
      token,
      method: 'POST',
    });
  } catch (error) {
    const status = statusFromError(error);
    if (status === 409) {
      try {
        const rawStatus = await deps.requestBackend(
          '/api/v1/onboarding/status',
          { token },
        );
        const parsedStatus =
          onboardingStatusResponseSchema.parse(rawStatus).data;
        if (parsedStatus.nextStep === 'content_unavailable') {
          return errorResponse(
            409,
            'content_unavailable',
            'Content is not available for this level.',
          );
        }
        return safeResponse(409);
      } catch {
        return safeResponse(409);
      }
    }
    return handleBackendError(error, deps);
  }
  if (!learningPlanCreatedResponseSchema.safeParse(rawPlan).success) {
    return safeResponse(503);
  }

  // 8. Success: 200 {success:true} + Cache-Control: no-store
  const response = NextResponse.json({ success: true }, { status: 200 });
  response.headers.set('cache-control', 'no-store');
  return response;
}
