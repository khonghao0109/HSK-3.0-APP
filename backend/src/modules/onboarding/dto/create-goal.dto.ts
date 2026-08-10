import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateGoalDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetLevelId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  targetBand?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  dailyMinutes!: number;

  @IsBoolean()
  reminderEnabled!: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    message: 'reminderTime must use HH:mm (24-hour) format.',
  })
  reminderTime?: string | null;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must use YYYY-MM-DD format.',
  })
  startDate!: string;
}
