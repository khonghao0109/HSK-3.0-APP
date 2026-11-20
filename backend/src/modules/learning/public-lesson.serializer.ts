import { Prisma } from '@prisma/client';

import { mediaAltText } from '../exam/exam-snapshot.builder';
import { projectPublicExerciseMedia } from './public-exercise.policy';

/** Ảnh bìa bài học và ảnh từ (Q350): chỉ lộ ảnh `ready`, chưa lưu trữ. */
export const PUBLIC_LESSON_IMAGE_SELECT = {
  id: true,
  type: true,
  processingStatus: true,
  deletedAt: true,
  metadata: true,
} satisfies Prisma.MediaSelect;

type PublicImageRecord = {
  id: number;
  type: string;
  processingStatus: string;
  deletedAt: Date | null;
  metadata: Prisma.JsonValue;
} | null;

export function projectPublicLessonImage(media: PublicImageRecord | undefined) {
  if (
    !media ||
    media.type !== 'image' ||
    media.processingStatus !== 'ready' ||
    media.deletedAt !== null
  ) {
    return null;
  }
  return { id: media.id, altText: mediaAltText(media.metadata) };
}

type PublicLessonRecord = {
  id: number;
  title: string;
  level: { id: number; name: string; orderIndex: number };
  topics: Array<{
    id: number;
    title: string;
    content: unknown;
    orderIndex: number;
  }>;
  lessonWords: Array<{
    topicId: number | null;
    word: {
      id: number;
      hanzi: string;
      traditional: string | null;
      pinyin: string;
      pinyinTone: string | null;
      meanings: Array<{ meaningEn: string | null; meaningVi: string | null }>;
      image?: PublicImageRecord;
    };
  }>;
  stories: Array<{
    id: number;
    title: string;
    content: unknown;
    slug: string;
  }>;
  exercises: Array<{
    id: number;
    type: string;
    prompt: string;
    content: unknown;
    version: number;
    orderIndex: number;
    media?: unknown;
    answer?: unknown;
    explanation?: string | null;
    [key: string]: unknown;
  }>;
  coverImage?: PublicImageRecord;
  [key: string]: unknown;
};

export function serializePublicLessonDetail(lesson: PublicLessonRecord) {
  const publicTopicIds = new Set(lesson.topics.map((topic) => topic.id));
  return {
    id: lesson.id,
    title: lesson.title,
    level: lesson.level,
    coverImage: projectPublicLessonImage(lesson.coverImage),
    topics: lesson.topics,
    words: lesson.lessonWords.map(({ topicId, word }) => ({
      id: word.id,
      // Topic draft hoặc đã xoá thì không lộ id (chỉ topic trong `topics`).
      topicId: topicId !== null && publicTopicIds.has(topicId) ? topicId : null,
      hanzi: word.hanzi,
      traditional: word.traditional,
      pinyin: word.pinyin,
      pinyinTone: word.pinyinTone,
      meanings: word.meanings.map((meaning) => ({
        en: meaning.meaningEn,
        vi: meaning.meaningVi,
      })),
      image: projectPublicLessonImage(word.image),
    })),
    stories: lesson.stories,
    exercises: lesson.exercises.map((exercise) => {
      const media = projectPublicExerciseMedia(exercise.type, exercise.media);
      return {
        id: exercise.id,
        type: exercise.type,
        prompt: exercise.prompt,
        content: exercise.content,
        version: exercise.version,
        orderIndex: exercise.orderIndex,
        media,
      };
    }),
  };
}
