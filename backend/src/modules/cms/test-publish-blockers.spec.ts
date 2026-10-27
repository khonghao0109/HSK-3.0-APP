import { ContentStatus, Skill } from '@prisma/client';

import {
  collectTestPublishBlockers,
  type TestPublishBlockerQuestion,
  type TestPublishBlockerTree,
} from './test-publish-blockers';

const PUBLISHED_QUESTION: TestPublishBlockerQuestion = {
  id: 10,
  status: ContentStatus.published,
  deletedAt: null,
  levelId: 1,
  skill: Skill.reading,
  audioId: null,
  imageId: null,
};

function tree(
  overrides: Partial<TestPublishBlockerTree> = {},
): TestPublishBlockerTree {
  return {
    levelId: 1,
    passScore: 50,
    sections: [
      {
        skill: Skill.reading,
        groups: [
          {
            audioId: null,
            imageId: null,
            placements: [{ testQuestion: { questionId: 10 } }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('collectTestPublishBlockers', () => {
  it('returns no blocker for a publishable tree', () => {
    expect(
      collectTestPublishBlockers({
        test: tree(),
        questions: [PUBLISHED_QUESTION],
        media: [],
        levelExists: true,
      }),
    ).toEqual([]);
  });

  it('reports a missing level and an empty section list', () => {
    expect(
      collectTestPublishBlockers({
        test: tree({ levelId: 9, sections: [], passScore: 0 }),
        questions: [],
        media: [],
        levelExists: false,
      }),
    ).toEqual([
      { code: 'level_not_found', field: 'levelId' },
      { code: 'sections_required', field: 'sections' },
    ]);
  });

  it('requires passScore and keeps it within 0..100 × sectionCount', () => {
    expect(
      collectTestPublishBlockers({
        test: tree({ passScore: null }),
        questions: [PUBLISHED_QUESTION],
        media: [],
        levelExists: true,
      }),
    ).toEqual([{ code: 'pass_score_required', field: 'passScore' }]);

    expect(
      collectTestPublishBlockers({
        test: tree({ passScore: 101 }),
        questions: [PUBLISHED_QUESTION],
        media: [],
        levelExists: true,
      }),
    ).toEqual([{ code: 'pass_score_out_of_range', field: 'passScore' }]);
  });

  it('reports an empty group inside a section', () => {
    expect(
      collectTestPublishBlockers({
        test: tree({
          sections: [{ skill: Skill.reading, groups: [] }],
          passScore: 0,
        }),
        questions: [],
        media: [],
        levelExists: true,
      }),
    ).toEqual([{ code: 'section_empty', field: 'sections[0]' }]);
  });

  it('collects every code that is true for one question in one round (H2)', () => {
    const blockers = collectTestPublishBlockers({
      test: tree({
        sections: [
          {
            skill: Skill.reading,
            groups: [
              {
                audioId: null,
                imageId: null,
                placements: [{ testQuestion: { questionId: 10 } }],
              },
            ],
          },
        ],
      }),
      questions: [
        {
          ...PUBLISHED_QUESTION,
          status: ContentStatus.draft,
          levelId: 2,
          skill: Skill.listening,
        },
      ],
      media: [],
      levelExists: true,
    });

    expect(blockers).toEqual([
      {
        code: 'question_not_published',
        field: 'sections[0].groups[0].questionIds[0]',
      },
      {
        code: 'question_level_mismatch',
        field: 'sections[0].groups[0].questionIds[0]',
      },
      {
        code: 'question_skill_mismatch',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);
  });

  it('treats a soft-deleted question as not published and stops evaluating it', () => {
    expect(
      collectTestPublishBlockers({
        test: tree(),
        questions: [],
        media: [],
        levelExists: true,
      }),
    ).toEqual([
      {
        code: 'question_not_published',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);

    expect(
      collectTestPublishBlockers({
        test: tree(),
        questions: [{ ...PUBLISHED_QUESTION, deletedAt: new Date() }],
        media: [],
        levelExists: true,
      }),
    ).toEqual([
      {
        code: 'question_not_published',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);
  });

  it('reports group media that can never be used or is not ready', () => {
    const blockers = collectTestPublishBlockers({
      test: tree({
        sections: [
          {
            skill: Skill.reading,
            groups: [
              {
                audioId: 20,
                imageId: 21,
                placements: [{ testQuestion: { questionId: 10 } }],
              },
            ],
          },
        ],
      }),
      questions: [PUBLISHED_QUESTION],
      media: [
        {
          id: 20,
          url: 'https://cdn.example.test/audio.mp3',
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 12,
          processingStatus: 'processing',
          deletedAt: null,
        },
        {
          id: 21,
          url: 'https://cdn.example.test/image.png',
          type: 'image',
          mimeType: 'image/png',
          duration: null,
          processingStatus: 'ready',
          deletedAt: new Date(),
        },
      ],
      levelExists: true,
    });

    expect(blockers).toEqual([
      { code: 'audio_not_ready', field: 'sections[0].groups[0].audioId' },
      { code: 'image_not_ready', field: 'sections[0].groups[0].imageId' },
    ]);
  });

  it('reports media that is missing entirely', () => {
    expect(
      collectTestPublishBlockers({
        test: tree({
          sections: [
            {
              skill: Skill.reading,
              groups: [
                {
                  audioId: 99,
                  imageId: null,
                  placements: [{ testQuestion: { questionId: 10 } }],
                },
              ],
            },
          ],
        }),
        questions: [PUBLISHED_QUESTION],
        media: [],
        levelExists: true,
      }),
    ).toEqual([
      { code: 'audio_not_ready', field: 'sections[0].groups[0].audioId' },
    ]);
  });

  it('reports question media that is not ready (TL-129)', () => {
    const blockers = collectTestPublishBlockers({
      test: tree(),
      questions: [
        {
          ...PUBLISHED_QUESTION,
          audioId: 30,
          imageId: 31,
        },
      ],
      media: [
        {
          id: 30,
          url: 'https://cdn.example.test/question.mp3',
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 12,
          processingStatus: 'pending',
          deletedAt: null,
        },
        {
          id: 31,
          url: 'https://cdn.example.test/question.png',
          type: 'image',
          mimeType: 'image/png',
          duration: null,
          processingStatus: 'ready',
          deletedAt: new Date(),
        },
      ],
      levelExists: true,
    });

    expect(blockers).toEqual([
      {
        code: 'question_audio_not_ready',
        field: 'sections[0].groups[0].questionIds[0]',
      },
      {
        code: 'question_image_not_ready',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);
  });

  it('reports missing question media and accepts ready question media', () => {
    expect(
      collectTestPublishBlockers({
        test: tree(),
        questions: [{ ...PUBLISHED_QUESTION, audioId: 77, imageId: null }],
        media: [],
        levelExists: true,
      }),
    ).toEqual([
      {
        code: 'question_audio_not_ready',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);

    expect(
      collectTestPublishBlockers({
        test: tree(),
        questions: [{ ...PUBLISHED_QUESTION, audioId: 30, imageId: 31 }],
        media: [
          {
            id: 30,
            url: 'https://cdn.example.test/question.mp3',
            type: 'audio',
            mimeType: 'audio/mpeg',
            duration: 12,
            processingStatus: 'ready',
            deletedAt: null,
          },
          {
            id: 31,
            url: 'https://cdn.example.test/question.png',
            type: 'image',
            mimeType: 'image/png',
            duration: null,
            processingStatus: 'ready',
            deletedAt: null,
          },
        ],
        levelExists: true,
      }),
    ).toEqual([]);
  });
});
