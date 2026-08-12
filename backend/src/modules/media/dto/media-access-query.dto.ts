import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

export class MediaContentAccessQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expires!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/u)
  signature!: string;
}
