import { describe, expect, it } from 'vitest';

import {
  EXERCISE_UNPUBLISHABLE_REASON,
  exercisePublishBlockReason,
  liveExerciseVersion,
  parseRouteId,
  topicPrefillFromSnapshot,
  workflowStep,
  type WorkflowRevision,
} from './content-values';

const revision: WorkflowRevision = {
  id: 70,
  revision: 2,
  authorId: 7,
  createdAt: '2026-10-15T10:00:00Z',
  reviews: [],
};

function reviewed(decision: string): WorkflowRevision {
  return {
    ...revision,
    reviews: [{ decision, reviewerId: 3, createdAt: '2026-10-15T11:00:00Z' }],
  };
}

const unpublished = { at: null, byId: null };

describe('workflowStep (TL-16)', () => {
  it('latest revision without review → step 2 "Chờ duyệt", by the author', () => {
    expect(workflowStep('draft', unpublished, revision)).toEqual({
      step: 2,
      note: 'Chờ duyệt',
      updatedAt: revision.createdAt,
      updatedById: 7,
    });
  });

  it('changes_requested / rejected → step 1 with "Cần sửa" / "Từ chối"', () => {
    expect(
      workflowStep('draft', unpublished, reviewed('changes_requested')),
    ).toMatchObject({ step: 1, note: 'Cần sửa', updatedById: 3 });
    expect(
      workflowStep('published', unpublished, reviewed('rejected')),
    ).toMatchObject({ step: 1, note: 'Từ chối' });
  });

  it('approved and not published (or published before the revision) → step 3', () => {
    expect(
      workflowStep('draft', unpublished, reviewed('approved')),
    ).toMatchObject({ step: 3, updatedAt: '2026-10-15T11:00:00Z' });
    expect(
      workflowStep(
        'published',
        { at: '2026-10-14T00:00:00Z', byId: 5 },
        reviewed('approved'),
      ),
    ).toMatchObject({ step: 3 });
  });

  it('published at or after the latest revision → step 4, by the publisher', () => {
    expect(
      workflowStep(
        'published',
        { at: '2026-10-15T12:00:00Z', byId: 5 },
        reviewed('approved'),
      ),
    ).toEqual({
      step: 4,
      note: null,
      updatedAt: '2026-10-15T12:00:00Z',
      updatedById: 5,
    });
  });

  it('approved review after publishing (same revision) → step 4, updated by the review', () => {
    expect(
      workflowStep(
        'published',
        { at: '2026-10-15T10:30:00Z', byId: 5 },
        reviewed('approved'),
      ),
    ).toEqual({
      step: 4,
      note: null,
      updatedAt: '2026-10-15T11:00:00Z',
      updatedById: 3,
    });
  });

  it('changes_requested after publishing the same revision → step 1 wins over step 4', () => {
    expect(
      workflowStep(
        'published',
        { at: '2026-10-15T10:30:00Z', byId: 5 },
        reviewed('changes_requested'),
      ),
    ).toMatchObject({ step: 1, note: 'Cần sửa' });
  });

  it('no revision at all → step 1 draft without timestamps, or step 4 when published', () => {
    expect(workflowStep('draft', unpublished, null)).toEqual({
      step: 1,
      note: null,
      updatedAt: null,
      updatedById: null,
    });
    expect(
      workflowStep('published', { at: '2026-10-15T12:00:00Z', byId: 5 }, null),
    ).toEqual({
      step: 4,
      note: null,
      updatedAt: '2026-10-15T12:00:00Z',
      updatedById: 5,
    });
  });

  it('archived → null (no 4 steps)', () => {
    expect(
      workflowStep(
        'archived',
        { at: '2026-10-15T12:00:00Z', byId: 5 },
        reviewed('approved'),
      ),
    ).toBeNull();
  });

  describe('S1: published trùng snapshot bản sửa mới nhất', () => {
    const lessonLive = {
      title: 'Bài 1',
      description: 'Mô tả',
      orderIndex: 2,
      slug: 'bai-1',
      status: 'published',
    };
    const lessonSnapshot = {
      title: 'Bài 1',
      description: 'Mô tả',
      orderIndex: 2,
      slug: 'bai-1',
    };
    const oldPublished = { at: '2026-10-14T00:00:00Z', byId: 5 };

    it('idempotent: publishedAt cũ hơn bản sửa nhưng live trùng snapshot → bước 4', () => {
      expect(
        workflowStep('published', oldPublished, reviewed('approved'), {
          entity: 'lesson',
          live: lessonLive,
          snapshot: lessonSnapshot,
        }),
      ).toMatchObject({ step: 4, note: null });
    });

    it('published + snapshot khác + publishedAt cũ → bước 3', () => {
      expect(
        workflowStep('published', oldPublished, reviewed('approved'), {
          entity: 'lesson',
          live: { ...lessonLive, title: 'Bài 1 (sửa)' },
          snapshot: lessonSnapshot,
        }),
      ).toMatchObject({ step: 3, note: null });
    });

    it('chuẩn hoá như backend: trim, description rỗng → null, slug lowercase, content canonical', () => {
      const normalized = workflowStep(
        'published',
        oldPublished,
        reviewed('approved'),
        {
          entity: 'lesson',
          live: {
            title: '  Bài 1  ',
            description: '   ',
            orderIndex: 2,
            slug: 'BAI-1',
          },
          snapshot: {
            title: 'Bài 1',
            description: null,
            orderIndex: 2,
            slug: 'bai-1',
          },
        },
      );
      expect(normalized).toMatchObject({ step: 4 });

      const topic = workflowStep(
        'published',
        oldPublished,
        reviewed('approved'),
        {
          entity: 'topic',
          live: {
            title: 'Chủ đề',
            subtitle: null,
            type: 'vocabulary',
            // Khoá khác thứ tự, array giữ nguyên thứ tự phần tử.
            content: [{ value: '你好', type: 'text' }],
            orderIndex: 1,
            isPremium: false,
            isLocked: false,
          },
          snapshot: {
            title: 'Chủ đề',
            subtitle: null,
            type: 'vocabulary',
            content: [{ type: 'text', value: '你好' }],
            orderIndex: 1,
            isPremium: false,
            isLocked: false,
          },
        },
      );
      expect(topic).toMatchObject({ step: 4 });
    });

    it('live khác kiểu/thiếu trường → không coi là trùng (bước 3)', () => {
      expect(
        workflowStep('published', oldPublished, reviewed('approved'), {
          entity: 'lesson',
          live: { title: 'Bài 1' },
          snapshot: lessonSnapshot,
        }),
      ).toMatchObject({ step: 3 });
    });
  });
});

describe('S1/TL-21: snapshot bài tập khi xét bước 4', () => {
  const exerciseLive = {
    id: 41,
    lessonId: 7,
    topicId: 9,
    type: 'mcq',
    prompt: 'Chọn lời chào đúng',
    content: {
      options: [
        { id: 'opt-1', text: '你好' },
        { id: 'opt-2', text: '再见' },
      ],
    },
    answer: { optionId: 'opt-1' },
    explanation: '你好 là lời chào.',
    mediaId: null,
    orderIndex: 3,
    status: 'published',
  };
  const exerciseSnapshot = {
    // Khoá khác thứ tự với live; backend so canonical nên phải khớp.
    orderIndex: 3,
    mediaId: null,
    explanation: '你好 là lời chào.',
    answer: { optionId: 'opt-1' },
    content: {
      options: [
        { id: 'opt-1', text: '你好' },
        { id: 'opt-2', text: '再见' },
      ],
    },
    prompt: 'Chọn lời chào đúng',
    type: 'mcq',
  };
  const publishedBefore = { at: '2026-10-14T00:00:00Z', byId: 5 };

  it('live trùng snapshot (kể cả thứ tự khoá) → bước 4', () => {
    expect(
      workflowStep('published', publishedBefore, reviewed('approved'), {
        entity: 'exercise',
        live: exerciseLive,
        snapshot: exerciseSnapshot,
        liveVersion: 2,
      }),
    ).toMatchObject({ step: 4, note: null });
  });

  it('R3: chỉ bước 4 khi nội dung khớp VÀ liveVersion === revision mới nhất', () => {
    const base = {
      entity: 'exercise' as const,
      live: exerciseLive,
      snapshot: exerciseSnapshot,
    };
    expect(
      workflowStep('published', publishedBefore, reviewed('approved'), {
        ...base,
        liveVersion: 2,
      }),
    ).toMatchObject({ step: 4, note: null });
    for (const liveVersion of [1, 3, null, undefined]) {
      expect(
        workflowStep('published', publishedBefore, reviewed('approved'), {
          ...base,
          liveVersion,
        }),
      ).toMatchObject({ step: 3 });
    }
    // publishedAt sau bản sửa nhưng version lệch vẫn không phải bước 4.
    expect(
      workflowStep(
        'published',
        { at: '2026-10-19T00:00:00Z', byId: 5 },
        reviewed('approved'),
        { ...base, liveVersion: 1 },
      ),
    ).toMatchObject({ step: 3 });
  });

  it('R3: liveExerciseVersion đọc version hợp lệ, còn lại null', () => {
    expect(liveExerciseVersion({ version: 3 })).toBe(3);
    for (const value of [null, undefined, '3', 0, -1, 1.5, {}, []]) {
      expect(liveExerciseVersion(value)).toBeNull();
    }
  });

  it('khác type/prompt/content/answer/explanation/mediaId/orderIndex → bước 3', () => {
    const changes = [
      { type: 'fill_blank' },
      { prompt: 'Câu khác' },
      { content: { options: [] } },
      { answer: { optionId: 'opt-2' } },
      { explanation: null },
      { mediaId: 9 },
      { orderIndex: 4 },
    ];
    for (const change of changes) {
      expect(
        workflowStep('published', publishedBefore, reviewed('approved'), {
          entity: 'exercise',
          live: { ...exerciseLive, ...change },
          snapshot: exerciseSnapshot,
        }),
      ).toMatchObject({ step: 3 });
    }
  });

  it('live thiếu trường hoặc sai kiểu → không coi là trùng', () => {
    for (const broken of [
      { type: 3 },
      { prompt: null },
      { content: [] },
      { answer: 'x' },
      { explanation: 5 },
      { mediaId: 'audio-1' },
      { orderIndex: '3' },
      { type: undefined },
    ]) {
      expect(
        workflowStep('published', publishedBefore, reviewed('approved'), {
          entity: 'exercise',
          live: { ...exerciseLive, ...broken },
          snapshot: exerciseSnapshot,
        }),
      ).toMatchObject({ step: 3 });
    }
  });
});

describe('TL-21: loại bài tập chưa xuất bản được', () => {
  it('chỉ speaking_repeat bị chặn, kèm câu lý do', () => {
    expect(exercisePublishBlockReason('speaking_repeat')).toBe(
      EXERCISE_UNPUBLISHABLE_REASON,
    );
    expect(EXERCISE_UNPUBLISHABLE_REASON).toBe('Loại này chưa xuất bản được.');
    for (const type of [
      'mcq',
      'listening_choice',
      'fill_blank',
      'arrange_sentence',
      'unknown_future_type',
    ]) {
      expect(exercisePublishBlockReason(type)).toBeNull();
    }
  });
});

describe('parseRouteId (R9)', () => {
  it('accepts positive int4 ids without leading zeros only', () => {
    expect(parseRouteId('1')).toBe(1);
    expect(parseRouteId('2147483647')).toBe(2147483647);
    for (const raw of [
      '0',
      '01',
      '-1',
      '2147483648',
      '99999999999',
      '1.5',
      'abc',
      '',
      undefined,
    ]) {
      expect(parseRouteId(raw)).toBeNull();
    }
  });
});

describe('topicPrefillFromSnapshot (R1)', () => {
  it('maps a valid snapshot and stringifies content', () => {
    expect(
      topicPrefillFromSnapshot({
        title: 'Từ vựng mới',
        subtitle: null,
        type: 'grammar',
        content: [{ type: 'text', value: '你好' }],
        orderIndex: 2,
        isPremium: true,
        isLocked: false,
      }),
    ).toEqual({
      title: 'Từ vựng mới',
      subtitle: null,
      type: 'grammar',
      contentText: JSON.stringify([{ type: 'text', value: '你好' }], null, 2),
      orderIndex: 2,
      isPremium: true,
      isLocked: false,
    });
  });

  it('returns null for an invalid snapshot so the page falls back to live', () => {
    const valid = {
      title: 'x',
      type: 'vocabulary',
      content: [],
      orderIndex: 1,
      isPremium: false,
      isLocked: false,
    };
    expect(topicPrefillFromSnapshot(null)).toBeNull();
    expect(topicPrefillFromSnapshot('x')).toBeNull();
    expect(topicPrefillFromSnapshot({ ...valid, type: 'nope' })).toBeNull();
    expect(topicPrefillFromSnapshot({ ...valid, orderIndex: '1' })).toBeNull();
    expect(topicPrefillFromSnapshot({ ...valid, subtitle: 3 })).toBeNull();
    const noContent: Record<string, unknown> = { ...valid };
    delete noContent.content;
    expect(topicPrefillFromSnapshot(noContent)).toBeNull();
  });
});
