export class LessonItemDto {
  id!: number;
  title!: string;
  description!: string | null;
  orderIndex!: number;
  slug!: string;
}

export class LessonDetailTopicDto {
  id!: number;
  title!: string;
  content!: unknown;
  orderIndex!: number;
}

export class LessonDetailWordMeaningDto {
  en!: string;
  vi!: string | null;
}

export class LessonDetailWordDto {
  id!: number;
  hanzi!: string;
  traditional!: string | null;
  pinyin!: string;
  pinyinTone!: string | null;
  meanings!: LessonDetailWordMeaningDto[];
}

export class LessonDetailStoryDto {
  id!: number;
  title!: string;
  content!: unknown;
  slug!: string;
}

export class LessonDetailLevelDto {
  id!: number;
  name!: string;
  orderIndex!: number;
}

export class LessonDetailDto {
  id!: number;
  title!: string;
  level!: LessonDetailLevelDto;
  topics!: LessonDetailTopicDto[];
  words!: LessonDetailWordDto[];
  stories!: LessonDetailStoryDto[];
}
