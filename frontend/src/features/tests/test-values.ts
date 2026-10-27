/**
 * Type và giá trị thuần cho trình xây dựng đề thi (M4.1b, TL-107/TL-108).
 * File này KHÔNG import `zod`/`server-only`: client component dùng trực tiếp để
 * Zod không lọt vào client bundle (`client-bundle-guard.spec.ts`).
 *
 * Nhãn hiển thị dùng lại `admin-labels.ts` (`skillLabel`, `questionTypeLabel`,
 * `contentStatusLabel`, `adminDateTime`); ở đây chỉ giữ giới hạn và các câu
 * tiếng Việt đặc thù của đề thi.
 */

export const TEST_STATUS_VALUES = ['draft', 'published', 'archived'] as const;
export const TEST_SKILL_VALUES = [
  'listening',
  'reading',
  'writing',
  'speaking',
] as const;

export type TestStatus = (typeof TEST_STATUS_VALUES)[number];
export type TestSkill = (typeof TEST_SKILL_VALUES)[number];

export type TestLevelOption = { id: number; code: string };

export type AdminTest = {
  id: number;
  levelId: number;
  levelCode: string;
  title: string;
  instruction: string | null;
  /** Thời gian làm bài của cả đề, đơn vị phút (Q118). */
  duration: number;
  passScore: number | null;
  /** 100 × sectionCount (Q118). */
  maxScore: number;
  status: TestStatus;
  version: number;
  sectionCount: number;
  questionCount: number;
  /** Skill khác nhau của các phần, theo thứ tự phần. */
  skills: TestSkill[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type AdminTestQuestion = {
  questionId: number;
  orderIndex: number;
  type: string;
  /** Kỹ năng của câu (có thể khác kỹ năng phần nếu đề chưa publish). */
  skill: string;
  levelId: number;
  difficulty: number | null;
  status: string;
  content: string;
};

export type AdminTestGroup = {
  id: number;
  title: string | null;
  instruction: string | null;
  audioId: number | null;
  imageId: number | null;
  orderIndex: number;
  questions: AdminTestQuestion[];
};

export type AdminTestSection = {
  id: number;
  skill: TestSkill;
  title: string;
  instruction: string | null;
  orderIndex: number;
  questionCount: number;
  groups: AdminTestGroup[];
};

export type AdminTestDetail = AdminTest & { sections: AdminTestSection[] };

/** Body PUT /admin/cms/tests/:id/structure (TL-96). */
export type TestStructureGroupInput = {
  title?: string | null;
  instruction?: string | null;
  audioId?: number | null;
  imageId?: number | null;
  questionIds: number[];
};

export type TestStructureSectionInput = {
  skill: TestSkill;
  title: string;
  instruction?: string | null;
  groups: TestStructureGroupInput[];
};

export type TestStructureInput = {
  expectedUpdatedAt: string;
  sections: TestStructureSectionInput[];
};

export type TestCreateInput = {
  levelId: number;
  title: string;
  instruction?: string | null;
  duration: number;
  passScore?: number | null;
};

export type TestPatchInput = {
  expectedUpdatedAt: string;
  levelId?: number;
  title?: string;
  instruction?: string | null;
  duration?: number;
  passScore?: number | null;
};

/** Hàng ngân hàng câu hỏi hiển thị trong builder (GET BFF questions). */
export type TestQuestionBankItem = {
  id: number;
  content: string;
  type: string;
  skill: string;
  levelId: number;
  difficulty: number | null;
  status: string;
};

export type TestQuestionBankPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type TestQuestionBankPage = {
  data: TestQuestionBankItem[];
  pagination: TestQuestionBankPagination;
};

export type TestPublishReason = {
  code: string;
  field: string;
};

/** Media option cho select Audio/Ảnh của nhóm (server nạp từ thư viện media). */
export type TestMediaOption = {
  id: number;
  filename: string | null;
  processingStatus: string;
};

export type TestFormOptions = {
  levels: TestLevelOption[];
  audio: TestMediaOption[];
  image: TestMediaOption[];
};

export type TestListQuery = {
  levelId?: number;
  status?: TestStatus;
  q?: string;
  page: number;
  limit: number;
};

export const TEST_LIMITS = {
  titleMaxLength: 200,
  instructionMaxLength: 2_000,
  durationMin: 1,
  durationMax: 300,
  maxSections: 10,
  minGroupsPerSection: 1,
  maxGroupsPerSection: 20,
  minQuestionsPerGroup: 1,
  maxQuestionsPerGroup: 50,
  maxQuestionsPerTest: 200,
  maxSectionTitleLength: 100,
  maxGroupTitleLength: 100,
  maxStructureInstructionLength: 1_000,
} as const;

/**
 * Thứ tự chuỗi lý do publish theo TL-108 (mã backend → câu tiếng Việt).
 * Fallback giữ mã gốc để không bịa nghĩa.
 */
export const TEST_PUBLISH_REASON_LABELS: Readonly<Record<string, string>> = {
  sections_required: 'Đề chưa có phần nào',
  section_empty: 'Phần chưa có câu',
  group_empty: 'Nhóm chưa có câu',
  question_not_published: 'Câu chưa xuất bản',
  question_level_mismatch: 'Câu khác cấp HSK của đề',
  question_skill_mismatch: 'Câu khác kỹ năng của phần',
  pass_score_required: 'Chưa nhập điểm đỗ',
  pass_score_out_of_range: 'Điểm đỗ vượt điểm tối đa',
  audio_not_ready: 'Audio của nhóm chưa sẵn sàng',
  image_not_ready: 'Ảnh của nhóm chưa sẵn sàng',
  level_not_found: 'Cấp HSK không tồn tại',
};

export function testPublishReasonLabel(code: string): string {
  return TEST_PUBLISH_REASON_LABELS[code] ?? code;
}

/**
 * Đổi `field` của backend (`sections[i].groups[j].questionIds[k]`, `passScore`,
 * `sections[i]`…) thành vị trí đọc được, ví dụ "Phần 1 › Nhóm 2 › Câu 3".
 */
export function testPublishReasonLocation(field: string): string | null {
  const section = /sections\[(\d+)\]/u.exec(field);
  if (!section?.[1]) return null;
  const parts = [`Phần ${String(Number(section[1]) + 1)}`];
  const group = /groups\[(\d+)\]/u.exec(field);
  if (group?.[1]) parts.push(`Nhóm ${String(Number(group[1]) + 1)}`);
  const question = /questionIds\[(\d+)\]/u.exec(field);
  if (question?.[1]) parts.push(`Câu ${String(Number(question[1]) + 1)}`);
  if (/audioId$/u.test(field)) parts.push('Audio');
  if (/imageId$/u.test(field)) parts.push('Ảnh');
  if (/instruction$/u.test(field)) parts.push('Hướng dẫn');
  if (/title$/u.test(field)) parts.push('Tên');
  return parts.join(' › ');
}

export function formatTestDuration(minutes: number): string {
  return `${String(minutes)} phút`;
}

/** "180/300" hoặc "—" khi chưa nhập điểm đỗ (TL-107). */
export function formatPassScore(
  passScore: number | null,
  maxScore: number,
): string {
  return passScore === null ? '—' : `${String(passScore)}/${String(maxScore)}`;
}

/** "Nghe hiểu · Đọc hiểu" theo thứ tự phần; rỗng → "—". */
export function formatTestSkills(
  skills: readonly string[],
  skillLabel: (skill: string) => string,
): string {
  return skills.length === 0 ? '—' : skills.map(skillLabel).join(' · ');
}
