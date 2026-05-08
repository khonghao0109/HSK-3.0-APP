export class LevelItemDto {
  id!: number;
  name!: string;
  orderIndex!: number;
}

export class LevelsResponseDto {
  success!: boolean;
  data!: LevelItemDto[];
}
