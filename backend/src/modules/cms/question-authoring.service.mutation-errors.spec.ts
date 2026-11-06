import { ConflictException } from '@nestjs/common';
import { Prisma, QuestionType, Skill } from '@prisma/client';

import { QuestionAuthoringService } from './question-authoring.service';

/**
 * M4.1a (TL-86): the three Prisma persistence conflicts cannot be reproduced
 * deterministically through e2e (a real unique clash, an FK/check violation
 * inside the transaction, or a real deadlock), so the service mapping is
 * exercised with real Prisma error codes. Archived/publish/archive-conflict
 * codes are covered by the e2e and DB concurrency suites.
 */
describe('QuestionAuthoringService mutation error mapping (M4.1a TL-86)', () => {
  const actor = { id: 1, role: 'admin' };
  const context = { correlationId: 'question-test-correlation' };
  const dto = {
    type: QuestionType.mcq,
    skill: Skill.reading,
    levelId: 1,
    content: 'Chọn lời chào đúng',
    answers: {
      options: [
        { id: 'hello', text: '你好' },
        { id: 'bye', text: '再见' },
      ],
    },
    correctAnswer: { optionId: 'hello' },
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
    const service = new QuestionAuthoringService(prisma as never, {} as never);
    try {
      await service.createQuestionRevision(actor, 1, dto, context);
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
    ['P2002', 'QUESTION_UNIQUE_CONFLICT', 'Question content conflicts.'],
    [
      'P2003',
      'QUESTION_CONSTRAINT_CONFLICT',
      'Question violates a database integrity constraint.',
    ],
    [
      'P2004',
      'QUESTION_CONSTRAINT_CONFLICT',
      'Question violates a database integrity constraint.',
    ],
    [
      'P2034',
      'QUESTION_CONCURRENT_UPDATE',
      'Concurrent Question update detected; retry the request.',
    ],
    [
      '40001',
      'QUESTION_CONCURRENT_UPDATE',
      'Concurrent Question update detected; retry the request.',
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
