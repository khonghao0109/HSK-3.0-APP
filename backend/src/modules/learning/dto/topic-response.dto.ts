import { ApiProperty } from '@nestjs/swagger';

import { JSON_OBJECT_SCHEMA } from '../../../common/openapi/json-schemas';

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
    };

export class TopicItemDto {
  id!: number;
  lessonId!: number;
  title!: string;

  @ApiProperty({ type: 'array', items: JSON_OBJECT_SCHEMA })
  content!: TopicContentBlock[];

  orderIndex!: number;
}
