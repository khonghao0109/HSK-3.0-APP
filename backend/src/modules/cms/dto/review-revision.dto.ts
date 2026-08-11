import { ContentReviewDecision } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ReviewRevisionDto {
  @IsEnum(ContentReviewDecision)
  decision!: ContentReviewDecision;

  @IsOptional()
  @IsString()
  @Length(0, 2_000)
  note?: string | null;
}
