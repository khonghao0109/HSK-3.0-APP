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
    word: {
      id: number;
      hanzi: string;
      traditional: string | null;
      pinyin: string;
      pinyinTone: string | null;
      meanings: Array<{ meaningEn: string | null; meaningVi: string | null }>;
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
    answer?: unknown;
    explanation?: string | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export function serializePublicLessonDetail(lesson: PublicLessonRecord) {
  return {
    id: lesson.id,
    title: lesson.title,
    level: lesson.level,
    topics: lesson.topics,
    words: lesson.lessonWords.map(({ word }) => ({
      id: word.id,
      hanzi: word.hanzi,
      traditional: word.traditional,
      pinyin: word.pinyin,
      pinyinTone: word.pinyinTone,
      meanings: word.meanings.map((meaning) => ({
        en: meaning.meaningEn,
        vi: meaning.meaningVi,
      })),
    })),
    stories: lesson.stories,
    exercises: lesson.exercises.map((exercise) => ({
      id: exercise.id,
      type: exercise.type,
      prompt: exercise.prompt,
      content: exercise.content,
      version: exercise.version,
      orderIndex: exercise.orderIndex,
    })),
  };
}
