import { ContentStatus, QuestionType, Skill } from '@prisma/client';

// Response models of the M4.1b test builder endpoints (TL-94/TL-95).

export class AdminTestQuestionDto {
  questionId!: number;
  /** Global 1..N order across the whole test (equals the placement order). */
  orderIndex!: number;
  type!: QuestionType;
  skill!: Skill;
  levelId!: number;
  difficulty!: number | null;
  status!: ContentStatus;
  content!: string;
}

export class AdminTestGroupDto {
  id!: number;
  title!: string | null;
  instruction!: string | null;
  audioId!: number | null;
  imageId!: number | null;
  orderIndex!: number;
  questions!: AdminTestQuestionDto[];
}

export class AdminTestSectionDto {
  id!: number;
  skill!: Skill;
  title!: string;
  instruction!: string | null;
  orderIndex!: number;
  questionCount!: number;
  groups!: AdminTestGroupDto[];
}

export class AdminTestDto {
  id!: number;
  levelId!: number;
  levelCode!: string;
  title!: string;
  instruction!: string | null;
  /** Whole-test duration in minutes (Q118). */
  duration!: number;
  passScore!: number | null;
  /** 100 × sectionCount (Q118). */
  maxScore!: number;
  status!: ContentStatus;
  version!: number;
  sectionCount!: number;
  questionCount!: number;
  /** Distinct section skills, in section order. */
  skills!: Skill[];
  createdAt!: Date;
  updatedAt!: Date;
  publishedAt!: Date | null;
}

export class AdminTestDetailDto extends AdminTestDto {
  /**
   * Full tree. Section and group ids change on every PUT structure (TL-95);
   * clients must re-read the detail instead of caching them.
   */
  sections!: AdminTestSectionDto[];
}
