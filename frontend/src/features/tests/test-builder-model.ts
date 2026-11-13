import {
  TEST_LIMITS,
  type AdminTestDetail,
  type AdminTestSection,
  type TestPublishReason,
  type TestSkill,
  type TestStructureSectionInput,
  testPublishReasonLocation,
} from './test-values';

/**
 * Mô hình nháp (client-only) của cây đề thi trong trình xây dựng (TL-108).
 * Mỗi phần/nhóm/câu giữ một `key` ổn định phía client vì id section/group của
 * backend đổi sau mỗi lần PUT structure; id chỉ dùng để hiển thị.
 */
export type GroupDraft = {
  key: string;
  title: string;
  instruction: string;
  audioId: number | null;
  imageId: number | null;
  questionIds: number[];
};

export type SectionDraft = {
  key: string;
  skill: TestSkill;
  title: string;
  instruction: string;
  groups: GroupDraft[];
};

export type QuestionDraft = {
  questionId: number;
  content: string;
  type: string;
  skill: string;
};

let keyCounter = 0;

function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${String(keyCounter)}`;
}

export function sectionFromDetail(section: AdminTestSection): SectionDraft {
  return {
    key: nextKey('section'),
    skill: section.skill,
    title: section.title,
    instruction: section.instruction ?? '',
    groups: section.groups.map((group) => ({
      key: nextKey('group'),
      title: group.title ?? '',
      instruction: group.instruction ?? '',
      audioId: group.audioId,
      imageId: group.imageId,
      questionIds: group.questions.map((question) => question.questionId),
    })),
  };
}

export function treeFromDetail(test: AdminTestDetail): SectionDraft[] {
  return test.sections.map(sectionFromDetail);
}

export function toStructureSections(
  sections: SectionDraft[],
): TestStructureSectionInput[] {
  return sections.map((section) => ({
    skill: section.skill,
    title: section.title.trim(),
    instruction: section.instruction.trim() || null,
    groups: section.groups.map((group) => ({
      title: group.title.trim() || null,
      instruction: group.instruction.trim() || null,
      audioId: group.audioId,
      imageId: group.imageId,
      questionIds: group.questionIds,
    })),
  }));
}

/** Dấu vân tay của cấu trúc chưa lưu; dùng để bật/tắt "Lưu cấu trúc". */
export function treeFingerprint(sections: SectionDraft[]): string {
  return JSON.stringify(toStructureSections(sections));
}

export function countQuestions(sections: SectionDraft[]): number {
  return sections.reduce(
    (total, section) =>
      total +
      section.groups.reduce(
        (groupTotal, group) => groupTotal + group.questionIds.length,
        0,
      ),
    0,
  );
}

export function flattenQuestionIds(sections: SectionDraft[]): Set<number> {
  const ids = new Set<number>();
  for (const section of sections) {
    for (const group of section.groups) {
      for (const questionId of group.questionIds) ids.add(questionId);
    }
  }
  return ids;
}

export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (
    index < 0 ||
    index >= items.length ||
    target < 0 ||
    target >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item === undefined) return items;
  next.splice(target, 0, item);
  return next;
}

export function addSection(
  sections: SectionDraft[],
  skill: TestSkill,
  title: string,
): SectionDraft[] {
  if (sections.length >= TEST_LIMITS.maxSections) return sections;
  return [
    ...sections,
    {
      key: nextKey('section'),
      skill,
      title,
      instruction: '',
      groups: [
        {
          key: nextKey('group'),
          title: '',
          instruction: '',
          audioId: null,
          imageId: null,
          questionIds: [],
        },
      ],
    },
  ];
}

export function addGroup(
  sections: SectionDraft[],
  sectionIndex: number,
): SectionDraft[] {
  const section = sections[sectionIndex];
  if (!section || section.groups.length >= TEST_LIMITS.maxGroupsPerSection) {
    return sections;
  }
  const next = [...sections];
  next[sectionIndex] = {
    ...section,
    groups: [
      ...section.groups,
      {
        key: nextKey('group'),
        title: '',
        instruction: '',
        audioId: null,
        imageId: null,
        questionIds: [],
      },
    ],
  };
  return next;
}

export type AddQuestionsResult = {
  sections: SectionDraft[];
  /** Số câu thực sự được thêm sau khi bỏ câu trùng và cắt theo chỗ trống (C4). */
  added: number;
};

/**
 * C4: chỉ thêm tới chỗ trống của nhóm đích (`groupRoom`), bỏ câu đã nằm ở bất
 * kỳ nhóm nào trong đề, và báo đúng số câu đã thêm.
 */
export function addQuestionsToGroup(
  sections: SectionDraft[],
  target: { sectionIndex: number; groupIndex: number },
  questionIds: number[],
): AddQuestionsResult {
  const section = sections[target.sectionIndex];
  const group = section?.groups[target.groupIndex];
  if (!section || !group) return { sections, added: 0 };
  const existing = flattenQuestionIds(sections);
  const candidates = questionIds.filter((id) => !existing.has(id));
  const additions = candidates.slice(0, Math.max(0, groupRoom(group)));
  if (additions.length === 0) return { sections, added: 0 };
  const next = [...sections];
  const nextGroups = [...section.groups];
  nextGroups[target.groupIndex] = {
    ...group,
    questionIds: [...group.questionIds, ...additions],
  };
  next[target.sectionIndex] = { ...section, groups: nextGroups };
  return { sections: next, added: additions.length };
}

export function sectionSkillLabel(skill: TestSkill): string {
  switch (skill) {
    case 'listening':
      return 'Nghe hiểu';
    case 'reading':
      return 'Đọc hiểu';
    case 'writing':
      return 'Viết';
    case 'speaking':
      return 'Nói';
  }
}

/**
 * Câu tiếng Việt + vị trí cho từng lý do publish (TL-108); vị trí tính từ
 * `field` của backend: `sections[0].groups[1].questionIds[2]` → "Phần 1 › Nhóm
 * 2 › Câu 3".
 */
export function publishReasonText(
  reason: TestPublishReason,
  label: (code: string) => string,
): { message: string; location: string | null } {
  const parts = label(reason.code);
  const location = testPublishReasonLocation(reason.field);
  return { message: parts, location };
}

/** Số câu tối đa cho phép thêm vào một nhóm (TL-96). */
export function groupRoom(group: GroupDraft): number {
  return TEST_LIMITS.maxQuestionsPerGroup - group.questionIds.length;
}
