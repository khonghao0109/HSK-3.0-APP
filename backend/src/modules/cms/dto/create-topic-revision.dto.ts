import { TopicType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
} from 'class-validator';

import { BoundedJsonPayload } from './bounded-json-payload.validator';
import { IsStrictBoolean } from '../../../common/decorators/is-strict-boolean.decorator';

export class CreateTopicRevisionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  subtitle?: string | null;

  @IsEnum(TopicType)
  type!: TopicType;

  @IsDefined()
  @Validate(BoundedJsonPayload)
  content!: unknown;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  orderIndex!: number;

  @IsStrictBoolean()
  isPremium!: boolean;

  @IsStrictBoolean()
  isLocked!: boolean;
}
