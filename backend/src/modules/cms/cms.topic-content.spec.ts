import { UnprocessableEntityException } from '@nestjs/common';

import { CmsService } from './cms.service';

/**
 * Block `grammar_point`/`dialogue` của `Topic.content` được kiểm khi tạo topic,
 * tạo bản sửa và publish; lỗi đầu tiên → 422 `topic_content_invalid` + `path`.
 */
describe('CmsService topic content blocks', () => {
  const actor = { id: 1, role: 'admin' };
  const context = { correlationId: 'test-correlation' };
  const invalidGrammarPoint = {
    type: 'grammar_point',
    title: 'Câu với 是',
    formula: [{ role: 'noun', zh: '是', vi: 'là' }],
    explanation: 'Chủ ngữ + 是 + danh từ.',
    examples: [
      {
        hanzi: '我是学生。',
        pinyin: 'Wǒ shì xuésheng.',
        vi: 'Tôi là học sinh.',
      },
    ],
  };
  const topicFields = {
    title: 'Ngữ pháp',
    subtitle: null,
    type: 'grammar' as const,
    orderIndex: 1,
    isPremium: false,
    isLocked: false,
  };

  function expect422(error: unknown): void {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      code: 'topic_content_invalid',
      path: 'content[0].formula[0].role',
      message: 'Topic content validation failed at content[0].formula[0].role.',
    });
  }

  async function caught(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error('expected an exception');
  }

  it('createTopic rejects an invalid grammar_point with 422 before touching prisma', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new CmsService(prisma as never, {} as never);
    const error = await caught(() =>
      service.createTopic(
        actor,
        { ...topicFields, lessonId: 1, content: [invalidGrammarPoint] },
        context,
      ),
    );
    expect422(error);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('createTopicRevision rejects an invalid grammar_point with 422 before touching prisma', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new CmsService(prisma as never, {} as never);
    const error = await caught(() =>
      service.createTopicRevision(
        actor,
        7,
        { ...topicFields, content: [invalidGrammarPoint] },
        context,
      ),
    );
    expect422(error);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('publishTopicRevision rejects a stored snapshot with an invalid block', async () => {
    const revision = {
      id: 11,
      revision: 2,
      snapshot: { ...topicFields, content: [invalidGrammarPoint] },
      contentHash: 'hash',
      reviews: [{ decision: 'approved' }],
    };
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      topic: {
        findUnique: jest.fn().mockResolvedValue({ lessonId: 3 }),
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          lessonId: 3,
          status: 'draft',
          deletedAt: null,
        }),
        update,
      },
      contentRevision: { findFirst: jest.fn().mockResolvedValue(revision) },
    };
    const prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const coordinator = { checkpoint: jest.fn() };
    const service = new CmsService(prisma as never, coordinator);
    const error = await caught(() =>
      service.publishTopicRevision(actor, 7, 11, context),
    );
    expect422(error);
    expect(update).not.toHaveBeenCalled();
  });

  it('createTopic still accepts a topic with only text blocks', async () => {
    const create = jest.fn().mockResolvedValue({ id: 5, status: 'draft' });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      lesson: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, deletedAt: null }),
        findUnique: jest.fn().mockResolvedValue({ id: 1, deletedAt: null }),
      },
      topic: { create },
      contentRevision: {
        create: jest.fn().mockResolvedValue({ revision: 1, contentHash: 'h' }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const coordinator = { checkpoint: jest.fn() };
    const service = new CmsService(prisma as never, coordinator);
    const result = await service.createTopic(
      actor,
      {
        ...topicFields,
        type: 'vocabulary',
        lessonId: 1,
        content: [{ type: 'text', value: 'Giới thiệu' }],
      },
      context,
    );
    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
