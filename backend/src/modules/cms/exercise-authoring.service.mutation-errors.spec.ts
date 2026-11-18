import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ExerciseAuthoringService } from './exercise-authoring.service';

/**
 * M5.1b1 — B1: ba mã 409 còn lại của LessonExercise (CONTENT_UNIQUE_CONFLICT,
 * CONTENT_CONSTRAINT_CONFLICT, CONTENT_CONCURRENT_UPDATE) không tái tạo ổn
 * định qua e2e (cần trùng unique thật, vi phạm FK/check giữa transaction hoặc
 * deadlock thật), nên kiểm ở mức service: transaction ném lỗi Prisma thật với
 * mã tương ứng → executeMutation đổi thành 409 kèm code, message giữ nguyên.
 * Ba mã còn lại (CONTENT_ARCHIVED, REVISION_NOT_LATEST,
 * TOPIC_LESSON_MISMATCH) và 422 EXERCISE_TYPE_NOT_PUBLISHABLE kiểm bằng e2e.
 */
describe('ExerciseAuthoringService mutation error mapping (M5.1b1 B1)', () => {
  const actor = { id: 1, role: 'admin' };
  const context = { correlationId: 'test-correlation' };
  const dto = {
    type: 'mcq' as const,
    prompt: 'Chọn lời chào đúng',
    content: {
      options: [
        { id: 'hello', text: '你好' },
        { id: 'bye', text: '再见' },
      ],
    },
    answer: { optionId: 'hello' },
    orderIndex: 1,
  };

  async function conflictFor(prismaCode: string) {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('db error', {
          code: prismaCode,
          clientVersion: 'test',
        }),
      ),
    };
    const service = new ExerciseAuthoringService(prisma as never, {} as never);
    try {
      await service.createExerciseRevision(actor, 1, dto, context);
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return (error as ConflictException).getResponse() as {
        code?: unknown;
        message?: unknown;
      };
    }
    throw new Error('expected a ConflictException');
  }

  it.each([
    ['P2002', 'CONTENT_UNIQUE_CONFLICT', 'LessonExercise content conflicts.'],
    [
      'P2003',
      'CONTENT_CONSTRAINT_CONFLICT',
      'LessonExercise violates a database integrity constraint.',
    ],
    [
      'P2004',
      'CONTENT_CONSTRAINT_CONFLICT',
      'LessonExercise violates a database integrity constraint.',
    ],
    [
      'P2034',
      'CONTENT_CONCURRENT_UPDATE',
      'Concurrent LessonExercise update detected; retry the request.',
    ],
    [
      '40001',
      'CONTENT_CONCURRENT_UPDATE',
      'Concurrent LessonExercise update detected; retry the request.',
    ],
  ])(
    'maps Prisma %s to %s and keeps the English message',
    async (prismaCode, expectedCode, expectedMessage) => {
      await expect(conflictFor(prismaCode)).resolves.toEqual({
        code: expectedCode,
        message: expectedMessage,
      });
    },
  );
});
