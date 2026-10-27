import { Skill } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';

import { TestMutationGuardDto } from './update-test.dto';

export const TEST_STRUCTURE_LIMITS = {
  maxSections: 10,
  minGroupsPerSection: 1,
  maxGroupsPerSection: 20,
  minQuestionsPerGroup: 1,
  maxQuestionsPerGroup: 50,
  maxQuestionsPerTest: 200,
  maxSectionTitleLength: 100,
  maxGroupTitleLength: 100,
  maxInstructionLength: 1_000,
} as const;

export class TestStructureGroupDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, TEST_STRUCTURE_LIMITS.maxGroupTitleLength)
  title?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, TEST_STRUCTURE_LIMITS.maxInstructionLength)
  instruction?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  audioId?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  imageId?: number | null;

  @IsArray()
  @ArrayMinSize(TEST_STRUCTURE_LIMITS.minQuestionsPerGroup)
  @ArrayMaxSize(TEST_STRUCTURE_LIMITS.maxQuestionsPerGroup)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(POSTGRESQL_INT4_MAX, { each: true })
  questionIds!: number[];
}

export class TestStructureSectionDto {
  @IsEnum(Skill)
  skill!: Skill;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, TEST_STRUCTURE_LIMITS.maxSectionTitleLength)
  title!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, TEST_STRUCTURE_LIMITS.maxInstructionLength)
  instruction?: string | null;

  // Every placement belongs to a group; a "no group" question is authored as a
  // group without a title (TL-96).
  @IsArray()
  @ArrayMinSize(TEST_STRUCTURE_LIMITS.minGroupsPerSection)
  @ArrayMaxSize(TEST_STRUCTURE_LIMITS.maxGroupsPerSection)
  @ValidateNested({ each: true })
  @Type(() => TestStructureGroupDto)
  groups!: TestStructureGroupDto[];
}

/** TL-96: replace the whole section/group/question tree in one transaction. */
export class ReplaceTestStructureDto extends TestMutationGuardDto {
  // 0 sections is allowed for a draft (the tree may be built step by step).
  @IsArray()
  @ArrayMaxSize(TEST_STRUCTURE_LIMITS.maxSections)
  @ValidateNested({ each: true })
  @Type(() => TestStructureSectionDto)
  sections!: TestStructureSectionDto[];
}
