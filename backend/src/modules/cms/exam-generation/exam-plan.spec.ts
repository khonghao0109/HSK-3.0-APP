import {
  planExam,
  type PlanSection,
  type PoolQuestion,
  type PoolSet,
  seededRandom,
} from './exam-plan';

const q = (
  id: number,
  format: string,
  extra: Partial<PoolQuestion> = {},
): PoolQuestion => ({
  id,
  type: 'mcq',
  skill: 'reading',
  tags: [format],
  difficulty: 1,
  setId: null,
  targetWordIds: [],
  usage: 0,
  ...extra,
});

const blueprint = (count: number, fromSet = false): PlanSection[] => [
  {
    skill: 'reading',
    title: 'Đọc',
    instruction: null,
    parts: [
      {
        key: 'r1',
        title: 'Phần 1',
        instruction: null,
        questionType: 'mcq',
        format: 'doc',
        questionCount: count,
        fromSet,
      },
    ],
  },
];

describe('planExam (Q357)', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    const pool = Array.from({ length: 30 }, (_, i) => q(i + 1, 'doc'));
    const pick = (seed: string) => {
      const plan = planExam(blueprint(5), pool, [], { seed });
      if (!plan.ok) throw new Error('plan failed');
      return plan.sections[0]?.groups[0]?.questionIds;
    };
    expect(pick('a')).toEqual(pick('a'));
    const distinct = new Set(
      ['a', 'b', 'c', 'd', 'e'].map((s) => JSON.stringify(pick(s))),
    );
    expect(distinct.size).toBeGreaterThan(1);
    expect(seededRandom('x')()).toBeGreaterThanOrEqual(0);
  });

  it('matches format, skill and type, skips set members and excluded ids', () => {
    const pool = [
      q(1, 'doc'),
      q(2, 'other'),
      q(3, 'doc', { skill: 'listening' }),
      q(4, 'doc', { type: 'true_false' }),
      q(5, 'doc', { setId: 9 }),
      q(6, 'doc'),
      q(7, 'doc'),
    ];
    const plan = planExam(blueprint(2), pool, [], {
      seed: 's',
      excludeQuestionIds: new Set([7]),
    });
    expect(plan.ok && plan.sections[0]?.groups[0]?.questionIds).toEqual([1, 6]);
  });

  it('prefers least used questions, avoids repeated target words, orders by difficulty', () => {
    const pool = [
      q(1, 'doc', { usage: 3 }),
      q(2, 'doc', { difficulty: 3, targetWordIds: [10] }),
      q(3, 'doc', { difficulty: 1, targetWordIds: [10] }),
      q(4, 'doc', { difficulty: 2, targetWordIds: [11] }),
    ];
    const plan = planExam(blueprint(2), pool, [], { seed: 'z' });
    if (!plan.ok) throw new Error('plan failed');
    const ids = plan.sections[0]?.groups[0]?.questionIds ?? [];
    expect(ids).toHaveLength(2);
    expect(ids).toContain(4);
    expect(ids).not.toContain(1);
    const difficulties = ids.map((id) => pool[id - 1]?.difficulty ?? 0);
    expect(difficulties).toEqual([...difficulties].sort());
  });

  it('reports the first part with too few questions', () => {
    const plan = planExam(blueprint(3), [q(1, 'doc'), q(2, 'doc')], [], {
      seed: 's',
    });
    expect(plan).toEqual({
      ok: false,
      partKey: 'r1',
      needed: 3,
      available: 2,
      fromSet: false,
    });
  });

  it('takes a whole set in set order with its shared image', () => {
    const pool = [5, 6, 7, 8].map((id) => q(id, 'doc', { setId: 1 }));
    const sets: PoolSet[] = [
      {
        id: 1,
        skill: 'reading',
        format: 'doc',
        imageId: 42,
        audioId: null,
        questionIds: [7, 5, 6],
      },
      {
        id: 2,
        skill: 'reading',
        format: 'doc',
        imageId: 43,
        audioId: null,
        questionIds: [8, 99],
      },
    ];
    const plan = planExam(blueprint(3, true), pool, sets, { seed: 's' });
    expect(plan.ok && plan.sections[0]?.groups[0]).toMatchObject({
      setId: 1,
      imageId: 42,
      questionIds: [7, 5, 6],
    });
    const none = planExam(blueprint(2, true), pool, sets, { seed: 's' });
    expect(none).toMatchObject({ ok: false, partKey: 'r1', fromSet: true });
  });
});
