import { ApiProperty } from '@nestjs/swagger';

// Response model of GET /dictionary/characters/strokes (G2d).

export class CharacterStrokesSourceDto {
  code!: string;
  name!: string;
  version!: string;
  license!: string | null;
  attribution!: string | null;
  referenceUrl!: string | null;
}

export class CharacterStrokesDto {
  hanzi!: string;
  /** `null` when the character is unknown or has no valid stroke data. */
  strokeCount!: number | null;
  @ApiProperty({ type: [String], nullable: true })
  strokes!: string[] | null;
  /** One entry per stroke: a list of `[x, y]` points. */
  @ApiProperty({
    nullable: true,
    type: 'array',
    items: {
      type: 'array',
      items: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
      },
    },
  })
  medians!: number[][][] | null;
  sourceCode!: string | null;
}

export class CharacterStrokesResponseDto {
  /** In request order, duplicates removed. */
  characters!: CharacterStrokesDto[];
  /** Distinct data sources of the characters that have strokes. */
  sources!: CharacterStrokesSourceDto[];
}
