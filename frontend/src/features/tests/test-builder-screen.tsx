'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { contentStatusLabel } from '@/features/admin-shell/admin-labels';

import { TestBuilderBank } from './test-builder-bank';
import {
  BuilderAddSectionDialog,
  BuilderConfirmDialog,
  BuilderMetaDialog,
  type MetaFormValue,
  type PublishFailure,
} from './test-builder-dialogs';
import {
  addGroup,
  addQuestionsToGroup,
  addSection,
  countQuestions,
  flattenQuestionIds,
  groupRoom,
  moveItem,
  toStructureSections,
  treeFingerprint,
  treeFromDetail,
  type SectionDraft,
} from './test-builder-model';
import { TestBuilderPanel, type PanelHandlers } from './test-builder-panel';
import {
  archiveTest,
  duplicateTest,
  patchTest,
  publishReasons,
  publishTest,
  saveTestStructure,
  type BuilderFailure,
} from './test-builder-request';
import type {
  AdminTestDetail,
  TestFormOptions,
  TestSkill,
} from './test-values';
import { testPublishReasonLocation } from './test-values';

function targetOptions(
  sections: SectionDraft[],
): Array<{ value: string; label: string; room: number }> {
  const options: Array<{ value: string; label: string; room: number }> = [];
  sections.forEach((section, sectionIndex) => {
    section.groups.forEach((group, groupIndex) => {
      const groupLabel = group.title.trim() || `Nhóm ${String(groupIndex + 1)}`;
      options.push({
        value: `${String(sectionIndex)}:${String(groupIndex)}`,
        label: `Phần ${String(sectionIndex + 1)}: ${section.title || '(chưa đặt tên)'} › ${groupLabel}`,
        room: groupRoom(group),
      });
    });
  });
  return options;
}

/** Nội dung câu để hiện đoạn trích trong panel (U5). */
function contentsFromDetail(detail: AdminTestDetail): Map<number, string> {
  const contents = new Map<number, string>();
  for (const section of detail.sections) {
    for (const group of section.groups) {
      for (const question of group.questions) {
        contents.set(question.questionId, question.content);
      }
    }
  }
  return contents;
}

function firstFieldPath(failure: BuilderFailure): string {
  const field = failure.details?.field;
  if (typeof field === 'string' && field) return field;
  const path = failure.details?.path;
  if (typeof path === 'string' && path) return path;
  return '';
}

/**
 * C1: câu tiếng Việt cho lỗi lưu cấu trúc; vị trí nối sau dấu " — ". Nhãn
 * media phân biệt bằng đuôi `field` (`audioId`/`imageId`).
 */
function saveFailureMessage(failure: BuilderFailure): string {
  if (failure.code === 'TEST_CONCURRENT_UPDATE') {
    return 'Đề vừa được người khác sửa. Tải lại để xem bản mới nhất.';
  }
  const reason = String(failure.details?.reason ?? '');
  if (failure.code === 'TEST_QUESTION_NOT_USABLE') {
    return reason === 'archived'
      ? 'Không lưu được: câu đã bị lưu trữ'
      : 'Không lưu được: câu không tồn tại';
  }
  if (failure.code === 'MEDIA_NOT_USABLE') {
    return firstFieldPath(failure).endsWith('audioId')
      ? 'Audio không dùng được'
      : 'Ảnh không dùng được';
  }
  if (failure.code === 'TEST_STRUCTURE_INVALID') {
    return 'Cấu trúc đề không hợp lệ';
  }
  return 'Không lưu được cấu trúc. Kiểm tra số câu, số nhóm và tên phần rồi thử lại.';
}

function saveFailureAnnouncement(failure: BuilderFailure): string {
  const message = saveFailureMessage(failure);
  const location = testPublishReasonLocation(firstFieldPath(failure));
  return location ? `${message} — ${location}` : message;
}

function isSameStructure(
  detail: AdminTestDetail,
  sections: SectionDraft[],
): boolean {
  return treeFingerprint(treeFromDetail(detail)) === treeFingerprint(sections);
}

/**
 * Trang builder `/admin/tests/[id]` (TL-108, vòng sửa 2).
 * U4 trạng thái mở/đóng theo index; U7 chỉ đọc một cột; C1/C3/C4 thông báo và
 * focus; C2 khoá control khi busy.
 */
export function TestBuilderScreen({
  initialTest,
  options,
}: {
  initialTest: AdminTestDetail;
  options: TestFormOptions;
}) {
  const router = useRouter();
  const [test, setTest] = useState<AdminTestDetail>(initialTest);
  const [initialSections] = useState<SectionDraft[]>(() =>
    treeFromDetail(initialTest),
  );
  const [sections, setSections] = useState<SectionDraft[]>(initialSections);
  // U4: đề nháp mở đầu với mọi phần đóng; đề chỉ đọc mở sẵn mọi phần.
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        initialTest.status === 'draft'
          ? []
          : initialSections.map((section) => section.key),
      ),
  );
  const [contentById, setContentById] = useState<ReadonlyMap<number, string>>(
    () => contentsFromDetail(initialTest),
  );
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [pending, setPending] = useState<
    'save' | 'publish' | 'archive' | 'duplicate' | 'meta' | null
  >(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaErrors, setMetaErrors] = useState<Record<string, string>>({});
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishFailure, setPublishFailure] = useState<PublishFailure | null>(
    null,
  );
  const [archiveOpen, setArchiveOpen] = useState(false);

  const metaOpener = useRef<HTMLElement | null>(null);
  const addSectionOpener = useRef<HTMLElement | null>(null);
  const publishOpener = useRef<HTMLElement | null>(null);
  const archiveOpener = useRef<HTMLElement | null>(null);
  const panelLiveRef = useRef<HTMLParagraphElement | null>(null);

  const busy = pending !== null;
  const readonly = test.status !== 'draft';
  const dirty = useMemo(
    () => !isSameStructure(test, sections),
    [test, sections],
  );
  const usedQuestionIds = useMemo(
    () => flattenQuestionIds(sections),
    [sections],
  );

  const openNewSections = useCallback((keys: string[]) => {
    setOpenSections((current) => new Set([...current, ...keys]));
  }, []);

  const toggleSection = useCallback((key: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * U4: thay cây sau mutation nhưng giữ trạng thái mở/đóng theo index; đề chỉ
   * đọc thì mở hết (U7). U5: cập nhật thêm nội dung câu từ TestDetail.
   */
  function applyServerTree(detail: AdminTestDetail): void {
    const nextSections = treeFromDetail(detail);
    const openByIndex = sections.map((section) =>
      openSections.has(section.key),
    );
    setTest(detail);
    setSections(nextSections);
    setContentById((current) => {
      const merged = new Map(current);
      for (const [id, content] of contentsFromDetail(detail)) {
        merged.set(id, content);
      }
      return merged;
    });
    setOpenSections(
      new Set(
        detail.status === 'draft'
          ? nextSections
              .filter((_section, index) => openByIndex[index] === true)
              .map((section) => section.key)
          : nextSections.map((section) => section.key),
      ),
    );
  }

  const handlers: PanelHandlers = {
    onEditMeta: (opener) => {
      metaOpener.current = opener;
      setMetaErrors({});
      setMetaOpen(true);
    },
    onToggleSection: toggleSection,
    onMoveSection: (index, delta) => {
      setSections((current) => moveItem(current, index, delta));
    },
    onRemoveSection: (index) => {
      setSections((current) =>
        current.filter((_item, position) => position !== index),
      );
      setAnnouncement(null);
    },
    onAddSection: (opener) => {
      addSectionOpener.current = opener;
      setAddSectionOpen(true);
    },
    onMoveGroup: (sectionIndex, groupIndex, delta) => {
      setSections((current) => {
        const section = current[sectionIndex];
        if (!section) return current;
        const next = [...current];
        next[sectionIndex] = {
          ...section,
          groups: moveItem(section.groups, groupIndex, delta),
        };
        return next;
      });
    },
    onRemoveGroup: (sectionIndex, groupIndex) => {
      setSections((current) => {
        const section = current[sectionIndex];
        if (!section) return current;
        const next = [...current];
        next[sectionIndex] = {
          ...section,
          groups: section.groups.filter(
            (_item, position) => position !== groupIndex,
          ),
        };
        return next;
      });
    },
    onAddGroup: (sectionIndex) => {
      setSections((current) => addGroup(current, sectionIndex));
    },
    onUpdateGroup: (sectionIndex, groupIndex, patch) => {
      setSections((current) => {
        const section = current[sectionIndex];
        const group = section?.groups[groupIndex];
        if (!section || !group) return current;
        const next = [...current];
        const nextGroups = [...section.groups];
        nextGroups[groupIndex] = { ...group, ...patch };
        next[sectionIndex] = { ...section, groups: nextGroups };
        return next;
      });
    },
    onMoveQuestion: (sectionIndex, groupIndex, questionIndex, delta) => {
      setSections((current) => {
        const section = current[sectionIndex];
        const group = section?.groups[groupIndex];
        if (!section || !group) return current;
        const next = [...current];
        const nextGroups = [...section.groups];
        nextGroups[groupIndex] = {
          ...group,
          questionIds: moveItem(group.questionIds, questionIndex, delta),
        };
        next[sectionIndex] = { ...section, groups: nextGroups };
        return next;
      });
    },
    onRemoveQuestion: (sectionIndex, groupIndex, questionIndex) => {
      setSections((current) => {
        const section = current[sectionIndex];
        const group = section?.groups[groupIndex];
        if (!section || !group) return current;
        const next = [...current];
        const nextGroups = [...section.groups];
        nextGroups[groupIndex] = {
          ...group,
          questionIds: group.questionIds.filter(
            (_item, position) => position !== questionIndex,
          ),
        };
        next[sectionIndex] = { ...section, groups: nextGroups };
        return next;
      });
    },
    onSave: (opener) => {
      void save(opener);
    },
    onPublish: (opener) => {
      publishOpener.current = opener;
      setPublishFailure(null);
      setPublishOpen(true);
    },
    onArchive: (opener) => {
      archiveOpener.current = opener;
      setArchiveOpen(true);
    },
    onDuplicate: () => {
      void duplicate();
    },
  };

  function handleUnauthorized(status: number): boolean {
    if (status === 401) {
      router.replace('/login?reason=session');
      return true;
    }
    if (status === 403) {
      router.replace('/forbidden');
      return true;
    }
    return false;
  }

  async function save(opener: HTMLElement | null): Promise<void> {
    void opener;
    setPending('save');
    setAnnouncement(null);
    const result = await saveTestStructure(test.id, {
      expectedUpdatedAt: test.updatedAt,
      sections: toStructureSections(sections),
    });
    setPending(null);
    if (result.ok) {
      applyServerTree(result.data);
      setAnnouncement('Đã lưu cấu trúc đề thi.');
      // C3: focus vào dòng trạng thái của panel thay vì rơi về <body>.
      panelLiveRef.current?.focus();
      return;
    }
    if (handleUnauthorized(result.failure.status)) return;
    setAnnouncement(saveFailureAnnouncement(result.failure));
  }

  async function confirmPublish(): Promise<void> {
    setPending('publish');
    const result = await publishTest(test.id, test.updatedAt);
    setPending(null);
    if (result.ok) {
      applyServerTree(result.data);
      setPublishOpen(false);
      publishOpener.current?.focus();
      setAnnouncement('Đã xuất bản đề thi.');
      return;
    }
    if (handleUnauthorized(result.failure.status)) return;
    if (result.failure.code === 'TEST_CONCURRENT_UPDATE') {
      setPublishFailure({ reasons: [], concurrent: true });
      return;
    }
    if (result.failure.code === 'TEST_NOT_PUBLISHABLE') {
      setPublishFailure({
        reasons: publishReasons(result.failure),
        concurrent: false,
      });
      return;
    }
    setPublishFailure({ reasons: [], concurrent: false });
    setAnnouncement('Không xuất bản được đề thi. Hãy thử lại.');
  }

  async function confirmArchive(): Promise<void> {
    setPending('archive');
    const result = await archiveTest(test.id);
    setPending(null);
    if (result.ok) {
      applyServerTree(result.data);
      setArchiveOpen(false);
      archiveOpener.current?.focus();
      setAnnouncement('Đã lưu trữ đề thi.');
      return;
    }
    if (handleUnauthorized(result.failure.status)) return;
    setArchiveOpen(false);
    setAnnouncement('Không lưu trữ được đề thi. Hãy thử lại.');
  }

  async function duplicate(): Promise<void> {
    setPending('duplicate');
    const result = await duplicateTest(test.id);
    setPending(null);
    if (result.ok) {
      router.push(`/admin/tests/${String(result.data.id)}`);
      return;
    }
    if (handleUnauthorized(result.failure.status)) return;
    setAnnouncement('Không nhân bản được đề thi. Hãy thử lại.');
  }

  /**
   * C5: validate client trước khi PATCH; lỗi 400/409/5xx hiện trong dialog,
   * gắn vào đúng field khi `details.path` khớp.
   */
  async function saveMeta(value: MetaFormValue): Promise<void> {
    const clientErrors: Record<string, string> = {};
    const trimmedTitle = value.title.trim();
    if (trimmedTitle.length < 1 || trimmedTitle.length > 200) {
      clientErrors.title = 'Tên đề phải từ 1 đến 200 ký tự.';
    }
    if (
      !Number.isInteger(value.duration) ||
      value.duration < 1 ||
      value.duration > 300
    ) {
      clientErrors.duration = 'Thời gian phải là số nguyên từ 1 đến 300 phút.';
    }
    const passScoreText = value.passScore.trim();
    if (passScoreText !== '') {
      const parsed = Number(passScoreText);
      if (!Number.isInteger(parsed) || parsed < 0) {
        clientErrors.passScore =
          'Điểm đỗ phải là số nguyên không âm hoặc để trống.';
      }
    }
    if (Object.keys(clientErrors).length > 0) {
      setMetaErrors(clientErrors);
      return;
    }

    setPending('meta');
    setMetaErrors({});
    const result = await patchTest(test.id, {
      expectedUpdatedAt: test.updatedAt,
      title: trimmedTitle,
      levelId: value.levelId,
      duration: value.duration,
      instruction: value.instruction.trim() || null,
      passScore: passScoreText === '' ? null : Number(passScoreText),
    });
    setPending(null);
    if (result.ok) {
      setTest(result.data);
      setMetaOpen(false);
      metaOpener.current?.focus();
      setAnnouncement('Đã cập nhật thông tin đề.');
      return;
    }
    if (handleUnauthorized(result.failure.status)) return;
    if (result.failure.code === 'TEST_CONCURRENT_UPDATE') {
      setMetaErrors({
        _form: 'Đề vừa được người khác sửa. Tải lại để xem bản mới nhất.',
      });
      return;
    }
    const path = result.failure.details?.path;
    if (typeof path === 'string' && path.length > 0) {
      setMetaErrors({
        [path]:
          result.failure.code === 'level_not_found'
            ? 'Cấp HSK không tồn tại.'
            : 'Giá trị không hợp lệ.',
      });
      return;
    }
    setMetaErrors({
      _form:
        result.failure.status >= 500
          ? 'Máy chủ tạm thời không phản hồi. Hãy thử lại.'
          : 'Không lưu được thông tin đề. Kiểm tra lại các trường.',
    });
  }

  /** C4: chỉ thêm tới chỗ trống của nhóm đích, báo đúng số câu đã thêm. */
  function addQuestions(
    target: string,
    questionIds: number[],
    contents: ReadonlyMap<number, string>,
  ): void {
    const [sectionText, groupText] = target.split(':');
    const sectionIndex = Number(sectionText);
    const groupIndex = Number(groupText);
    if (!Number.isInteger(sectionIndex) || !Number.isInteger(groupIndex)) {
      return;
    }
    const result = addQuestionsToGroup(
      sections,
      { sectionIndex, groupIndex },
      questionIds,
    );
    setSections(result.sections);
    if (result.added === 0) {
      setAnnouncement(
        'Không thêm câu nào: nhóm đích đã đủ câu hoặc các câu đã có trong đề.',
      );
      return;
    }
    setContentById((current) => {
      const merged = new Map(current);
      for (const questionId of questionIds) {
        const content = contents.get(questionId);
        if (content !== undefined && merged.get(questionId) === undefined) {
          merged.set(questionId, content);
        }
      }
      return merged;
    });
    const skipped = questionIds.length - result.added;
    setAnnouncement(
      skipped > 0
        ? `Đã thêm ${String(result.added)} câu vào đề (bỏ qua ${String(skipped)} câu trùng hoặc vượt giới hạn nhóm, chưa lưu).`
        : `Đã thêm ${String(result.added)} câu vào đề (chưa lưu).`,
    );
  }

  function addSectionDraft(skill: string, title: string): void {
    setSections((current) => {
      const next = addSection(current, skill as TestSkill, title);
      const created = next[next.length - 1];
      // U4: phần mới thêm tự mở, các phần khác giữ nguyên trạng thái.
      if (created) openNewSections([created.key]);
      return next;
    });
    setAddSectionOpen(false);
    addSectionOpener.current?.focus();
    setAnnouncement(`Đã thêm phần "${title}" (chưa lưu).`);
  }

  const questionCount = countQuestions(sections);
  const metaValue: MetaFormValue = {
    title: test.title,
    levelId: test.levelId,
    duration: test.duration,
    passScore: test.passScore === null ? '' : String(test.passScore),
    instruction: test.instruction ?? '',
  };

  return (
    <div className="adm-page-stack tst-page">
      <header className="adm-page-head">
        <div>
          <p className="adm-muted">
            <Link className="tst-back" href="/admin/tests">
              <AdminIcon
                name="chevron-left"
                className="adm-icon adm-icon--sm"
              />
              Danh sách đề thi
            </Link>
          </p>
          <h1>{readonly ? test.title : 'Trình xây dựng đề thi'}</h1>
          <p>
            {`${String(sections.length)} phần · ${String(questionCount)} câu · ${String(test.duration)} phút · HSK ${test.levelCode.replace(/^HSK/u, '')}`}
          </p>
        </div>
        {readonly ? (
          <div className="adm-page-head__actions tst-page-actions">
            <AdminBadge
              status={test.status}
              label={contentStatusLabel(test.status)}
            />
            <button
              className="adm-btn adm-btn--primary"
              type="button"
              disabled={busy}
              onClick={handlers.onDuplicate}
            >
              Nhân bản thành nháp
            </button>
            {test.status === 'published' ? (
              <button
                className="adm-btn adm-btn--danger"
                type="button"
                disabled={busy}
                onClick={(event) => handlers.onArchive(event.currentTarget)}
              >
                Lưu trữ
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div
        className={readonly ? 'tst-layout tst-layout--readonly' : 'tst-layout'}
      >
        {readonly ? null : (
          <TestBuilderBank
            levelId={test.levelId}
            levelCode={test.levelCode}
            existingIds={usedQuestionIds}
            targets={targetOptions(sections)}
            busy={busy}
            onAdd={addQuestions}
          />
        )}
        <TestBuilderPanel
          test={{
            id: test.id,
            title: test.title,
            status: test.status,
            levelCode: test.levelCode,
            duration: test.duration,
            passScore: test.passScore,
            maxScore: 100 * sections.length,
            publishedAt: test.publishedAt,
          }}
          sections={sections}
          options={options}
          openSections={openSections}
          dirty={dirty}
          busy={busy}
          announcement={announcement ?? (dirty ? 'Có thay đổi chưa lưu' : null)}
          contentById={contentById}
          liveRef={panelLiveRef}
          handlers={handlers}
        />
      </div>

      <BuilderMetaDialog
        open={metaOpen}
        value={metaValue}
        levels={options.levels}
        busy={busy}
        errors={metaErrors}
        openerRef={metaOpener}
        onClose={() => {
          if (busy) return;
          setMetaOpen(false);
          metaOpener.current?.focus();
        }}
        onSave={(value) => {
          void saveMeta(value);
        }}
      />
      <BuilderAddSectionDialog
        open={addSectionOpen}
        busy={busy}
        count={sections.length}
        maxSections={10}
        openerRef={addSectionOpener}
        onClose={() => {
          if (busy) return;
          setAddSectionOpen(false);
          addSectionOpener.current?.focus();
        }}
        onAdd={addSectionDraft}
      />
      <BuilderConfirmDialog
        open={publishOpen}
        title="Xuất bản đề thi"
        description="Sau khi xuất bản, đề chỉ đọc. Muốn sửa phải lưu trữ rồi nhân bản thành đề nháp mới."
        confirmLabel="Xuất bản đề thi"
        busy={busy}
        openerRef={publishOpener}
        failure={publishFailure}
        onReload={() => window.location.reload()}
        onClose={() => {
          if (busy) return;
          setPublishOpen(false);
          publishOpener.current?.focus();
        }}
        onConfirm={() => {
          void confirmPublish();
        }}
      />
      <BuilderConfirmDialog
        open={archiveOpen}
        title="Lưu trữ đề thi"
        description="Đề lưu trữ không sửa được nữa; có thể nhân bản thành đề nháp mới."
        confirmLabel="Lưu trữ"
        tone="danger"
        busy={busy}
        openerRef={archiveOpener}
        onClose={() => {
          if (busy) return;
          setArchiveOpen(false);
          archiveOpener.current?.focus();
        }}
        onConfirm={() => {
          void confirmArchive();
        }}
      />
    </div>
  );
}
