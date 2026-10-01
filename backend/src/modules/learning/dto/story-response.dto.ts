import { ApiProperty } from '@nestjs/swagger';

import { JSON_OBJECT_SCHEMA } from '../../../common/openapi/json-schemas';

export type StoryContentBlock = {
  type: 'text';
  value: string;
};

export class StoryItemDto {
  id!: number;
  levelId!: number;
  title!: string;

  @ApiProperty({ type: 'array', items: JSON_OBJECT_SCHEMA })
  content!: StoryContentBlock[];

  slug!: string;
}
