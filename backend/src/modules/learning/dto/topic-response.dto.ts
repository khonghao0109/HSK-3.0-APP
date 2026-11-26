import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';

import { JSON_OBJECT_SCHEMA } from '../../../common/openapi/json-schemas';
import { DictionaryWordAudioDto } from '../../dictionary/dto/dictionary-word-response.dto';

export type TopicContentBlock =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'image';
      url: string;
      alt?: string;
    }
  | {
      type: 'audio';
      url: string;
      title?: string;
    }
  | TopicDialogueBlockDto;

export class TopicDialogueLineDto {
  speaker!: string;
  hanzi!: string;
  pinyin!: string;
  vi!: string;
}

/**
 * M2.13d: block `dialogue` learner nhận. `audio` là audio cả bài khoá (audio,
 * ready, chưa xoá) hoặc `null`; `audioMediaId` lưu trong CMS không bao giờ
 * được trả cho learner.
 */
export class TopicDialogueBlockDto {
  @ApiProperty({ enum: ['dialogue'] })
  type!: 'dialogue';

  lines!: TopicDialogueLineDto[];

  @ApiProperty({ type: DictionaryWordAudioDto, nullable: true })
  audio!: DictionaryWordAudioDto | null;
}

@ApiExtraModels(TopicDialogueBlockDto)
export class TopicItemDto {
  id!: number;
  lessonId!: number;
  title!: string;

  @ApiProperty({
    type: 'array',
    items: JSON_OBJECT_SCHEMA,
    description:
      'Block `dialogue` có dạng `TopicDialogueBlockDto` (M2.13d); cùng dạng ở lesson detail và lesson activity.',
  })
  content!: TopicContentBlock[];

  orderIndex!: number;
}
