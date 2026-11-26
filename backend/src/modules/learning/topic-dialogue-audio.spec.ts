import { projectTopicDialogueAudio } from './topic-dialogue-audio';

type MediaRow = {
  id: number;
  type: string;
  mimeType: string | null;
  duration: number | null;
  processingStatus: string;
  deletedAt: Date | null;
};

function client(rows: MediaRow[]) {
  const findMany = jest.fn<Promise<MediaRow[]>, [unknown]>(() =>
    Promise.resolve(rows),
  );
  return { findMany, prisma: { media: { findMany } } as never };
}

const ready = (id: number, extra: Partial<MediaRow> = {}): MediaRow => ({
  id,
  type: 'audio',
  mimeType: 'audio/mpeg',
  duration: 12,
  processingStatus: 'ready',
  deletedAt: null,
  ...extra,
});

const line = { speaker: 'A', hanzi: '你好', pinyin: 'nǐ hǎo', vi: 'chào' };

describe('projectTopicDialogueAudio (M2.13d)', () => {
  it('replaces audioMediaId with the public audio, in one query for all topics', async () => {
    const { findMany, prisma } = client([
      ready(7),
      ready(8, { processingStatus: 'processing' }),
      ready(9, { type: 'image' }),
      ready(10, { deletedAt: new Date('2026-11-24') }),
    ]);
    const topics = [
      {
        id: 1,
        content: [
          { type: 'dialogue', lines: [line], audioMediaId: 7 },
          { type: 'dialogue', lines: [line], audioMediaId: 8 },
          { type: 'text', value: 'x' },
        ],
      },
      {
        id: 2,
        content: [
          { type: 'dialogue', lines: [line], audioMediaId: 9 },
          { type: 'dialogue', lines: [line], audioMediaId: 10 },
          { type: 'dialogue', lines: [line], audioMediaId: 11 },
          { type: 'dialogue', lines: [line] },
        ],
      },
    ];

    const result = await projectTopicDialogueAudio(prisma, topics);

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as {
      where: { id: { in: number[] } };
    };
    expect([...args.where.id.in].sort((a, b) => a - b)).toEqual([
      7, 8, 9, 10, 11,
    ]);
    expect(result[0].content).toEqual([
      {
        type: 'dialogue',
        lines: [line],
        audio: { mediaId: 7, mimeType: 'audio/mpeg', duration: 12 },
      },
      { type: 'dialogue', lines: [line], audio: null },
      { type: 'text', value: 'x' },
    ]);
    expect(result[1].content).toEqual([
      { type: 'dialogue', lines: [line], audio: null },
      { type: 'dialogue', lines: [line], audio: null },
      { type: 'dialogue', lines: [line], audio: null },
      { type: 'dialogue', lines: [line], audio: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('audioMediaId');
  });

  it('skips the query when no dialogue carries audio and keeps other content', async () => {
    const { findMany, prisma } = client([]);
    const topics = [
      { id: 3, content: [{ type: 'vocabulary_list', value: 'lesson_words' }] },
      { id: 4, content: { legacy: true } },
    ];
    expect(await projectTopicDialogueAudio(prisma, topics)).toEqual(topics);
    expect(findMany).not.toHaveBeenCalled();
  });
});
