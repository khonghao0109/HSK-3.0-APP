import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CmsService } from './cms.service';

/**
 * R15: CONTENT_CONSTRAINT_CONFLICT và CONTENT_CONCURRENT_UPDATE không tái tạo
 * ổn định được qua e2e (cần vi phạm FK/check giữa transaction hoặc deadlock
 * thật), nên kiểm ở mức service: transaction ném lỗi Prisma thật với mã
 * tương ứng → executeMutation đổi thành 409 kèm code.
 */
describe('CmsService mutation error mapping (R15)', () => {
  const actor = { id: 1, role: 'admin' };
  const context = { correlationId: 'test-correlation' };
  const dto = {
    title: 'Bài',
    description: 'Mô tả',
    orderIndex: 1,
    slug: 'bai',
  };

  async function codeFor(prismaCode: string): Promise<unknown> {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('db error', {
          code: prismaCode,
          clientVersion: 'test',
        }),
      ),
    };
    const service = new CmsService(prisma as never, {} as never);
    try {
      await service.createLessonRevision(actor, 1, dto, context);
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return ((error as ConflictException).getResponse() as { code?: unknown })
        .code;
    }
    throw new Error('expected a ConflictException');
  }

  it.each([
    ['P2003', 'CONTENT_CONSTRAINT_CONFLICT'],
    ['P2004', 'CONTENT_CONSTRAINT_CONFLICT'],
    ['P2034', 'CONTENT_CONCURRENT_UPDATE'],
  ])('maps Prisma %s to %s', async (prismaCode, expected) => {
    await expect(codeFor(prismaCode)).resolves.toBe(expected);
  });
});
