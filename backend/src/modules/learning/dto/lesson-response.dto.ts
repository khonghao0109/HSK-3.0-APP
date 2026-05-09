export class LessonItemDto {
  id!: number;
  title!: string;
  description!: string | null;
  orderIndex!: number;
  slug!: string;
}

export class LessonsResponseDto {
  success!: boolean;
  data!: LessonItemDto[];
}
