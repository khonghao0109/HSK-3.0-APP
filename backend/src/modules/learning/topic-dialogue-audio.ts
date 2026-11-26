import type { Prisma } from '@prisma/client';

import {
  PUBLIC_WORD_AUDIO_SELECT,
  projectPublicWordAudio,
} from '../dictionary/public-word.policy';

type DialogueBlock = Record<string, unknown> & { type: 'dialogue' };

function isDialogue(block: unknown): block is DialogueBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    !Array.isArray(block) &&
    (block as Record<string, unknown>).type === 'dialogue'
  );
}

function audioMediaIdOf(block: DialogueBlock): number | null {
  const id = block.audioMediaId;
  return Number.isSafeInteger(id) && (id as number) > 0 ? (id as number) : null;
}

/**
 * M2.13d: learner không nhận `audioMediaId` thô của block `dialogue`. Mỗi block
 * `dialogue` trả `audio: { mediaId, mimeType, duration } | null`, cùng luật
 * với audio của Word (audio, ready, chưa xoá). Mọi id của các topic được lấy
 * bằng một truy vấn; block khác và content không phải mảng giữ nguyên.
 */
export async function projectTopicDialogueAudio<T extends { content: unknown }>(
  client: Pick<Prisma.TransactionClient, 'media'>,
  topics: readonly T[],
): Promise<T[]> {
  const ids = new Set<number>();
  for (const topic of topics) {
    if (!Array.isArray(topic.content)) continue;
    for (const block of topic.content as unknown[]) {
      const id = isDialogue(block) ? audioMediaIdOf(block) : null;
      if (id !== null) ids.add(id);
    }
  }
  const rows =
    ids.size === 0
      ? []
      : await client.media.findMany({
          where: { id: { in: [...ids] } },
          select: PUBLIC_WORD_AUDIO_SELECT,
        });
  const audio = new Map(
    rows.map((row) => [row.id, projectPublicWordAudio(row)]),
  );
  return topics.map((topic) =>
    Array.isArray(topic.content)
      ? {
          ...topic,
          content: (topic.content as unknown[]).map((block) => {
            if (!isDialogue(block)) return block;
            const id = audioMediaIdOf(block);
            const rest = Object.fromEntries(
              Object.entries(block).filter(([key]) => key !== 'audioMediaId'),
            );
            return { ...rest, audio: (id && audio.get(id)) ?? null };
          }),
        }
      : topic,
  );
}
