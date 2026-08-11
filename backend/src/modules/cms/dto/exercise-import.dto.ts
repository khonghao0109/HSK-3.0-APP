import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsHash,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';
import { EXERCISE_IMPORT_V1_MAX_ROWS } from '../exercise-import/exercise-import.constants';

export class PreviewExerciseImportDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  dataSourceId!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFKC').trim() : value,
  )
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EXERCISE_IMPORT_V1_MAX_ROWS)
  @Type(() => Object)
  rows!: unknown[];
}

export class CommitExerciseImportDto extends PreviewExerciseImportDto {
  @IsHash('sha256')
  previewHash!: string;
}
