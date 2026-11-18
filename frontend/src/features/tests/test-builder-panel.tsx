'use client';

import { useState, type RefObject } from 'react';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { contentStatusLabel } from '@/features/admin-shell/admin-labels';

import {
  countQuestions,
  sectionSkillLabel,
  type SectionDraft,
} from './test-builder-model';
import {
  TEST_LIMITS,
  formatPassScore,
  formatTestDuration,
  type TestFormOptions,
} from './test-values';

export type PanelHandlers = {
  onEditMeta: (opener: HTMLButtonElement) => void;
  onToggleSection: (key: string) => void;
  onMoveSection: (index: number, delta: -1 | 1) => void;
  onRemoveSection: (index: number) => void;
  onAddSection: (opener: HTMLButtonElement) => void;
  onMoveGroup: (
    sectionIndex: number,
    groupIndex: number,
    delta: -1 | 1,
  ) => void;
  onRemoveGroup: (sectionIndex: number, groupIndex: number) => void;
  onAddGroup: (sectionIndex: number) => void;
  onUpdateGroup: (
    sectionIndex: number,
    groupIndex: number,
    patch: {
      title?: string;
      instruction?: string;
      audioId?: number | null;
      imageId?: number | null;
    },
  ) => void;
  onMoveQuestion: (
    sectionIndex: number,
    groupIndex: number,
    questionIndex: number,
    delta: -1 | 1,
  ) => void;
  onRemoveQuestion: (
    sectionIndex: number,
    groupIndex: number,
    questionIndex: number,
  ) => void;
  onSave: (opener: HTMLButtonElement) => void;
  onPublish: (opener: HTMLButtonElement) => void;
  onArchive: (opener: HTMLButtonElement) => void;
  onDuplicate: () => void;
};

function mediaOptions(
  list: TestFormOptions['audio'],
): Array<{ value: string; label: string }> {
  return [
    { value: '', label: 'Không dùng' },
    ...list.map((media) => ({
      value: String(media.id),
      label: media.filename ?? `Media #${String(media.id)}`,
    })),
  ];
}

function mediaName(
  list: TestFormOptions['audio'],
  mediaId: number | null,
): string {
  if (mediaId === null) return 'Không dùng';
  const found = list.find((media) => media.id === mediaId);
  return found?.filename ?? `Media #${String(mediaId)}`;
}

/**
 * Panel "Trình xây dựng đề thi" bên phải (TL-108). Vòng sửa 2:
 * U4 mặc định đóng (state do screen quản lý), phần mới tự mở, giữ trạng thái
 * theo index; U5 dòng câu có đoạn trích + `title`; U6 đúng một nút "Thêm nhóm"
 * mỗi phần; U7 đề published/archived chỉ đọc, text-only, badge + nút thao tác ở
 * đầu panel; C2 khoá control khi busy; C3 focus dòng trạng thái sau khi lưu.
 */
export function TestBuilderPanel({
  test,
  sections,
  options,
  openSections,
  dirty,
  busy,
  announcement,
  contentById,
  liveRef,
  handlers,
}: {
  test: {
    id: number;
    title: string;
    status: string;
    levelCode: string;
    duration: number;
    passScore: number | null;
    maxScore: number;
    publishedAt: string | null;
  };
  sections: SectionDraft[];
  options: TestFormOptions;
  openSections: ReadonlySet<string>;
  dirty: boolean;
  busy: boolean;
  announcement: string | null;
  contentById: ReadonlyMap<number, string>;
  liveRef: RefObject<HTMLParagraphElement | null>;
  handlers: PanelHandlers;
}) {
  const readonly = test.status !== 'draft';
  const total = countQuestions(sections);
  const maxScore = 100 * sections.length;
  const [audioChoices] = useState(() => mediaOptions(options.audio));
  const [imageChoices] = useState(() => mediaOptions(options.image));

  return (
    <aside
      className={
        readonly
          ? 'adm-card tst-panel tst-panel--readonly'
          : 'adm-card tst-panel'
      }
      aria-labelledby="tst-panel-title"
    >
      <header className="tst-panel__head">
        <div>
          <p className="tst-panel__eyebrow">Trình xây dựng đề thi</p>
          <h2 className="tst-panel__title" id="tst-panel-title">
            {test.title}
          </h2>
          <p className="tst-panel__meta">
            <AdminBadge
              status={test.status}
              label={contentStatusLabel(test.status)}
            />
            <span>{`HSK ${test.levelCode.replace(/^HSK/u, '')}`}</span>
            <span>{formatTestDuration(test.duration)}</span>
          </p>
        </div>
        {readonly ? null : (
          <button
            className="adm-icon-btn"
            type="button"
            aria-label="Sửa thông tin đề"
            disabled={busy}
            onClick={(event) => handlers.onEditMeta(event.currentTarget)}
          >
            <AdminIcon name="pencil" className="adm-icon adm-icon--sm" />
          </button>
        )}
      </header>

      <div className="tst-panel__sections">
        {sections.length === 0 ? (
          <p className="adm-muted tst-panel__empty">
            Đề chưa có phần nào. Thêm phần rồi chọn câu từ ngân hàng bên trái.
          </p>
        ) : null}
        {sections.map((section, sectionIndex) => {
          const open = openSections.has(section.key);
          const questionCount = section.groups.reduce(
            (sum, group) => sum + group.questionIds.length,
            0,
          );
          return (
            <section className="tst-section" key={section.key}>
              <div className="tst-section__head">
                <div className="tst-section__text">
                  <button
                    className="tst-section__toggle"
                    type="button"
                    aria-expanded={open}
                    aria-controls={`tst-section-body-${section.key}`}
                    onClick={() => handlers.onToggleSection(section.key)}
                  >
                    {`Phần ${String(sectionIndex + 1)}: ${section.title || '(chưa đặt tên)'}`}
                  </button>
                  <p className="tst-section__meta">
                    {`${String(questionCount)} câu`}
                    <span aria-hidden="true"> · </span>
                    <span className="tst-badge">
                      {sectionSkillLabel(section.skill)}
                    </span>
                  </p>
                </div>
                {readonly ? null : (
                  <div className="tst-controls">
                    <button
                      className="adm-icon-btn"
                      type="button"
                      aria-label={`Đưa phần ${String(sectionIndex + 1)} lên`}
                      disabled={busy || sectionIndex === 0}
                      onClick={() => handlers.onMoveSection(sectionIndex, -1)}
                    >
                      <AdminIcon
                        name="chevron-left"
                        className="adm-icon adm-icon--sm tst-icon-up"
                      />
                    </button>
                    <button
                      className="adm-icon-btn"
                      type="button"
                      aria-label={`Đưa phần ${String(sectionIndex + 1)} xuống`}
                      disabled={busy || sectionIndex === sections.length - 1}
                      onClick={() => handlers.onMoveSection(sectionIndex, 1)}
                    >
                      <AdminIcon
                        name="chevron-right"
                        className="adm-icon adm-icon--sm tst-icon-down"
                      />
                    </button>
                    <button
                      className="adm-icon-btn"
                      type="button"
                      aria-label={`Xoá phần ${String(sectionIndex + 1)}`}
                      disabled={busy}
                      onClick={() => handlers.onRemoveSection(sectionIndex)}
                    >
                      <AdminIcon name="x" className="adm-icon adm-icon--sm" />
                    </button>
                  </div>
                )}
              </div>

              {open ? (
                <div
                  className="tst-section__body"
                  id={`tst-section-body-${section.key}`}
                >
                  {section.groups.length === 0 ? (
                    <p className="adm-muted">Phần chưa có nhóm nào.</p>
                  ) : null}
                  {section.groups.map((group, groupIndex) => (
                    <div className="tst-group" key={group.key}>
                      <div className="tst-group__head">
                        {readonly ? (
                          <p className="tst-group__title">
                            {group.title.trim() ||
                              `Nhóm ${String(groupIndex + 1)}`}
                          </p>
                        ) : (
                          <label className="tst-field tst-field--inline">
                            <span className="sr-only">
                              {`Tên nhóm ${String(groupIndex + 1)} của phần ${String(sectionIndex + 1)}`}
                            </span>
                            <input
                              className="adm-input tst-input--title"
                              value={group.title}
                              maxLength={TEST_LIMITS.maxGroupTitleLength}
                              placeholder={`Nhóm ${String(groupIndex + 1)}`}
                              disabled={busy}
                              onChange={(event) =>
                                handlers.onUpdateGroup(
                                  sectionIndex,
                                  groupIndex,
                                  {
                                    title: event.target.value,
                                  },
                                )
                              }
                            />
                          </label>
                        )}
                        {readonly ? null : (
                          <div className="tst-controls">
                            <button
                              className="adm-icon-btn"
                              type="button"
                              aria-label={`Đưa nhóm ${String(groupIndex + 1)} lên`}
                              disabled={busy || groupIndex === 0}
                              onClick={() =>
                                handlers.onMoveGroup(
                                  sectionIndex,
                                  groupIndex,
                                  -1,
                                )
                              }
                            >
                              <AdminIcon
                                name="chevron-left"
                                className="adm-icon adm-icon--sm tst-icon-up"
                              />
                            </button>
                            <button
                              className="adm-icon-btn"
                              type="button"
                              aria-label={`Đưa nhóm ${String(groupIndex + 1)} xuống`}
                              disabled={
                                busy || groupIndex === section.groups.length - 1
                              }
                              onClick={() =>
                                handlers.onMoveGroup(
                                  sectionIndex,
                                  groupIndex,
                                  1,
                                )
                              }
                            >
                              <AdminIcon
                                name="chevron-right"
                                className="adm-icon adm-icon--sm tst-icon-down"
                              />
                            </button>
                            <button
                              className="adm-icon-btn"
                              type="button"
                              aria-label={`Xoá nhóm ${String(groupIndex + 1)}`}
                              disabled={busy}
                              onClick={() =>
                                handlers.onRemoveGroup(sectionIndex, groupIndex)
                              }
                            >
                              <AdminIcon
                                name="x"
                                className="adm-icon adm-icon--sm"
                              />
                            </button>
                          </div>
                        )}
                      </div>

                      {readonly ? (
                        <div className="tst-group__media-text">
                          <p>
                            {`Audio: ${mediaName(options.audio, group.audioId)}`}
                          </p>
                          <p>
                            {`Ảnh: ${mediaName(options.image, group.imageId)}`}
                          </p>
                        </div>
                      ) : (
                        <div className="tst-group__media">
                          <label className="tst-field">
                            <span>Audio</span>
                            <select
                              className="adm-input"
                              value={
                                group.audioId === null
                                  ? ''
                                  : String(group.audioId)
                              }
                              disabled={busy}
                              onChange={(event) =>
                                handlers.onUpdateGroup(
                                  sectionIndex,
                                  groupIndex,
                                  {
                                    audioId:
                                      event.target.value === ''
                                        ? null
                                        : Number(event.target.value),
                                  },
                                )
                              }
                            >
                              {audioChoices.map((choice) => (
                                <option value={choice.value} key={choice.value}>
                                  {choice.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="tst-field">
                            <span>Ảnh</span>
                            <select
                              className="adm-input"
                              value={
                                group.imageId === null
                                  ? ''
                                  : String(group.imageId)
                              }
                              disabled={busy}
                              onChange={(event) =>
                                handlers.onUpdateGroup(
                                  sectionIndex,
                                  groupIndex,
                                  {
                                    imageId:
                                      event.target.value === ''
                                        ? null
                                        : Number(event.target.value),
                                  },
                                )
                              }
                            >
                              {imageChoices.map((choice) => (
                                <option value={choice.value} key={choice.value}>
                                  {choice.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}

                      <ul
                        className="tst-questions"
                        aria-label={`Câu của nhóm ${String(groupIndex + 1)}`}
                      >
                        {group.questionIds.length === 0 ? (
                          <li className="adm-muted">Nhóm chưa có câu.</li>
                        ) : null}
                        {group.questionIds.map((questionId, questionIndex) => {
                          const content = contentById.get(questionId) ?? '';
                          return (
                            <li className="tst-question" key={questionId}>
                              <span className="tst-question__id">
                                {`Q${String(questionId)}`}
                              </span>
                              <span
                                className="tst-question__content"
                                title={content}
                              >
                                {content || '(chưa có nội dung)'}
                              </span>
                              {readonly ? null : (
                                <span className="tst-controls">
                                  <button
                                    className="adm-icon-btn"
                                    type="button"
                                    aria-label={`Đưa câu Q${String(questionId)} lên`}
                                    disabled={busy || questionIndex === 0}
                                    onClick={() =>
                                      handlers.onMoveQuestion(
                                        sectionIndex,
                                        groupIndex,
                                        questionIndex,
                                        -1,
                                      )
                                    }
                                  >
                                    <AdminIcon
                                      name="chevron-left"
                                      className="adm-icon adm-icon--sm tst-icon-up"
                                    />
                                  </button>
                                  <button
                                    className="adm-icon-btn"
                                    type="button"
                                    aria-label={`Đưa câu Q${String(questionId)} xuống`}
                                    disabled={
                                      busy ||
                                      questionIndex ===
                                        group.questionIds.length - 1
                                    }
                                    onClick={() =>
                                      handlers.onMoveQuestion(
                                        sectionIndex,
                                        groupIndex,
                                        questionIndex,
                                        1,
                                      )
                                    }
                                  >
                                    <AdminIcon
                                      name="chevron-right"
                                      className="adm-icon adm-icon--sm tst-icon-down"
                                    />
                                  </button>
                                  <button
                                    className="adm-icon-btn"
                                    type="button"
                                    aria-label={`Bỏ câu Q${String(questionId)} khỏi đề`}
                                    disabled={busy}
                                    onClick={() =>
                                      handlers.onRemoveQuestion(
                                        sectionIndex,
                                        groupIndex,
                                        questionIndex,
                                      )
                                    }
                                  >
                                    <AdminIcon
                                      name="x"
                                      className="adm-icon adm-icon--sm"
                                    />
                                  </button>
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}

                  {/* U6: đúng một nút "Thêm nhóm" cho mỗi phần, sau nhóm cuối. */}
                  {readonly ? null : (
                    <button
                      className="adm-btn adm-btn--outline adm-btn--sm tst-section__add-group"
                      type="button"
                      disabled={
                        busy ||
                        section.groups.length >= TEST_LIMITS.maxGroupsPerSection
                      }
                      onClick={() => handlers.onAddGroup(sectionIndex)}
                    >
                      Thêm nhóm
                    </button>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {readonly ? null : (
        <button
          className="adm-btn adm-btn--outline tst-panel__add-section"
          type="button"
          disabled={busy || sections.length >= TEST_LIMITS.maxSections}
          onClick={(event) => handlers.onAddSection(event.currentTarget)}
        >
          <AdminIcon name="plus" className="adm-icon adm-icon--sm" />
          Thêm phần
        </button>
      )}

      <dl className="tst-summary">
        <div>
          <dt>Tổng số câu</dt>
          <dd>{String(total)}</dd>
        </div>
        <div>
          <dt>Thời gian</dt>
          <dd>{formatTestDuration(test.duration)}</dd>
        </div>
        <div>
          <dt>Điểm tối đa</dt>
          <dd>{String(maxScore)}</dd>
        </div>
        <div>
          <dt>Điểm đỗ</dt>
          <dd>{formatPassScore(test.passScore, maxScore)}</dd>
        </div>
      </dl>

      {/* C3: sau khi lưu, focus chuyển vào dòng trạng thái này. */}
      <p
        className="tst-live"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={liveRef}
      >
        {announcement ?? ''}
      </p>

      {readonly ? null : (
        <div className="tst-panel__footer">
          <button
            className="adm-btn adm-btn--outline"
            type="button"
            disabled={busy || !dirty}
            onClick={(event) => handlers.onSave(event.currentTarget)}
          >
            {busy ? 'Đang lưu…' : 'Lưu cấu trúc'}
          </button>
          <button
            className="adm-btn adm-btn--primary"
            type="button"
            disabled={busy || dirty}
            aria-describedby={dirty ? 'tst-publish-hint' : undefined}
            onClick={(event) => handlers.onPublish(event.currentTarget)}
          >
            Xuất bản đề thi
          </button>
          {dirty ? (
            <p className="tst-hint" id="tst-publish-hint">
              Lưu cấu trúc trước khi xuất bản
            </p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
