import { ContentStatus, CourseKind, CourseVolume } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';
import { IsStrictBoolean } from '../../../common/decorators/is-strict-boolean.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

import { CreateLessonRevisionDto } from './create-lesson-revision.dto';

// Mirrors the SQL checks of migration 20261123090000_course_expand.
export const COURSE_CODE_PATTERN = /^[A-Z0-9_]{3,40}$/;
export const CURRICULUM_VERSIONS = ['HSK_2_0', 'HSK_3_0'] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AdminCoursesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CourseKind)
  kind?: CourseKind;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  @IsIn(CURRICULUM_VERSIONS)
  curriculumVersion?: string;
}

export class CreateCourseDto {
  @Matches(COURSE_CODE_PATTERN)
  code!: string;

  @IsEnum(CourseKind)
  kind!: CourseKind;

  @IsOptional()
  @IsIn(CURRICULUM_VERSIONS)
  curriculumVersion?: string | null;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2_000)
  description?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  orderIndex!: number;

  @IsOptional()
  @IsStrictBoolean()
  keyTextVisible?: boolean;
}

/** Optimistic concurrency token echoed from `updatedAt` (TL-94 pattern). */
export class CourseMutationGuardDto {
  @IsISO8601()
  expectedUpdatedAt!: string;
}

/** `code` and `kind` are not accepted: forbidNonWhitelisted answers 400. */
export class UpdateCourseDto extends CourseMutationGuardDto {
  @ValidateIf((dto: UpdateCourseDto) => dto.title !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2_000)
  description?: string | null;

  @ValidateIf((dto: UpdateCourseDto) => dto.orderIndex !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  orderIndex?: number;

  @ValidateIf((dto: UpdateCourseDto) => dto.keyTextVisible !== undefined)
  @IsStrictBoolean()
  keyTextVisible?: boolean;
}

export class AdminCourseUnitsQueryDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  courseId!: number;
}

export class CreateCourseUnitDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  courseId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  orderIndex!: number;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  gradeNumber?: number | null;

  // CourseUnit_volume_grade_check: a volume needs a grade.
  @ValidateIf((dto: CreateCourseUnitDto) => dto.volume != null)
  @IsEnum(CourseVolume)
  volume?: CourseVolume | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  levelId?: number | null;
}

export class UpdateCourseUnitDto extends CourseMutationGuardDto {
  @ValidateIf((dto: UpdateCourseUnitDto) => dto.orderIndex !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  orderIndex?: number;

  @ValidateIf((dto: UpdateCourseUnitDto) => dto.title !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  gradeNumber?: number | null;

  @IsOptional()
  @IsEnum(CourseVolume)
  volume?: CourseVolume | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  levelId?: number | null;
}

/** Same fields as CreateLessonDto without `levelId`: the unit decides it. */
export class CreateCourseUnitLessonDto extends CreateLessonRevisionDto {}
