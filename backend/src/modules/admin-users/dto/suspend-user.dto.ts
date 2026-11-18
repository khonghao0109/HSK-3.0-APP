import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class SuspendUserDto {
  /**
   * TL-63: the stored reason is the trimmed input and must be 1–500 chars.
   * Declared `unknown` on purpose: with `enableImplicitConversion`, a JSON
   * number or boolean would be coerced to text before validation and accepted.
   * The controller narrows it after validation proves it is a string.
   */
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500)
  reason!: unknown;
}
