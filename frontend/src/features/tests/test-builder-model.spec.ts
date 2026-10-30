import { describe, expect, it } from 'vitest';

import {
  addQuestionsToGroup,
  groupRoom,
  type SectionDraft,
} from './test-builder-model';

/**
 * C4 (M4.1b vòng sửa 2): thêm câu chỉ tới chỗ trống của nhóm đích, bỏ câu đã có
 * trong đề, và trả về đúng số câu thực sự đã thêm để thông báo cho tác giả.
 */
function sectionWith(questionIds: number[]): SectionDraft {
  return {
    key: 'section-1',
    skill: 'reading',
    title: 'Phần đọc',
    instruction: '',
    groups: [
      {
        key: 'group-1',
        title: '',
        instruction: '',
        audioId: null,
        imageId: null,
        questionIds,
      },
    ],
  };
}

describe('addQuestionsToGroup (C4)', () => {
  it('thêm hết khi còn chỗ và báo đúng số câu đã thêm', () => {
    const result = addQuestionsToGroup(
      [sectionWith([1, 2, 3])],
      { sectionIndex: 0, groupIndex: 0 },
      [4, 5, 6],
    );
    expect(result.added).toBe(3);
    expect(result.sections[0]?.groups[0]?.questionIds).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('nhóm đủ 50 câu thì không thêm câu nào (và groupRoom = 0)', () => {
    const full = Array.from({ length: 50 }, (_unused, index) => index + 1);
    const result = addQuestionsToGroup(
      [sectionWith(full)],
      { sectionIndex: 0, groupIndex: 0 },
      [51, 52],
    );
    expect(groupRoom({ ...sectionWith(full).groups[0]! })).toBe(0);
    expect(result.added).toBe(0);
    expect(result.sections[0]?.groups[0]?.questionIds).toEqual(full);
  });

  it('bỏ câu đã có trong đề và chỉ thêm tới chỗ trống', () => {
    // Nhóm đích còn 1 chỗ; câu 50 đã nằm ở nhóm khác trong đề.
    const target = sectionWith(
      Array.from({ length: 49 }, (_unused, index) => index + 1),
    );
    const other: SectionDraft = {
      key: 'section-2',
      skill: 'reading',
      title: 'Phần khác',
      instruction: '',
      groups: [
        {
          key: 'group-2',
          title: '',
          instruction: '',
          audioId: null,
          imageId: null,
          questionIds: [2, 50],
        },
      ],
    };
    const result = addQuestionsToGroup(
      [target, other],
      { sectionIndex: 0, groupIndex: 0 },
      [2, 50, 51, 52],
    );
    expect(result.added).toBe(1);
    expect(result.sections[0]?.groups[0]?.questionIds).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
      40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51,
    ]);
  });
});
