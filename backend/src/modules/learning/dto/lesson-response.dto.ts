import { ApiProperty } from '@nestjs/swagger';

import { JSON_OBJECT_OR_ARRAY_SCHEMA } from '../../../common/openapi/json-schemas';

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

  @ApiProperty(JSON_OBJECT_OR_ARRAY_SCHEMA)
  content!: unknown;

  orderIndex!: number;
}

export class LessonDetailWordMeaningDto {
  en!: string | null;
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

  @ApiProperty(JSON_OBJECT_OR_ARRAY_SCHEMA)
  content!: unknown;

  slug!: string;
}

export class LessonDetailExerciseDto {
  id!: number;
  type!: string;
  prompt!: string;

  @ApiProperty(JSON_OBJECT_OR_ARRAY_SCHEMA)
  content!: unknown;

  version!: number;
  orderIndex!: number;
  media!: LessonDetailExerciseMediaDto | null;
}

export class LessonDetailExerciseMediaDto {
  id!: number;
  url!: string;
  type!: 'audio';
  mimeType!: string | null;
  duration!: number | null;
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
  exercises!: LessonDetailExerciseDto[];
}
