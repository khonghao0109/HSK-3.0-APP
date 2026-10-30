'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  difficultyLabel,
  questionTypeLabel,
  skillLabel,
} from '@/features/admin-shell/admin-labels';

import { fetchQuestionBank, type BankQuery } from './test-builder-request';
import type { TestQuestionBankPage } from './test-values';

const SKILLS = [
  { value: '', label: 'Tất cả kỹ năng' },
  { value: 'listening', label: 'Nghe hiểu' },
  { value: 'reading', label: 'Đọc hiểu' },
  { value: 'writing', label: 'Viết' },
  { value: 'speaking', label: 'Nói' },
];

const TYPES = [
  { value: '', label: 'Tất cả dạng câu' },
  { value: 'mcq', label: 'Trắc nghiệm' },
  { value: 'true_false', label: 'Đúng/Sai' },
  { value: 'fill_blank', label: 'Điền từ' },
  { value: 'arrange_sentence', label: 'Sắp xếp câu' },
];

const PAGE_SIZE = 10;

/**
 * Bảng câu hỏi bên trái của builder (TL-108): luôn khoá theo level của đề và
 * `status=published`, gọi GET BFF `/api/admin/questions` (TL-105).
 */
export function TestBuilderBank({
  levelId,
  levelCode,
  existingIds,
  targets,
  busy,
  onAdd,
}: {
  levelId: number;
  levelCode: string;
  existingIds: ReadonlySet<number>;
  /** "Phần 1 › Nhóm 2" → value "0:1" kèm số chỗ còn trống (C4). */
  targets: Array<{ value: string; label: string; room: number }>;
  busy: boolean;
  onAdd: (
    target: string,
    questionIds: number[],
    contents: ReadonlyMap<number, string>,
  ) => void;
}) {
  const [skill, setSkill] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [target, setTarget] = useState('');
  const [loaded, setLoaded] = useState<{
    key: string;
    page: TestQuestionBankPage | null;
    failed: boolean;
  }>({ key: '', page: null, failed: false });

  const query: BankQuery = useMemo(
    () => ({ levelId, skill, type, q: search, page, limit: PAGE_SIZE }),
    [levelId, skill, type, search, page],
  );
  const queryKey = JSON.stringify(query);
  // Trạng thái "đang tải" suy ra từ khoá truy vấn đã nạp, không setState đồng
  // bộ trong effect (react-hooks/set-state-in-effect).
  const loading = loaded.key !== queryKey;
  const error = !loading && loaded.failed;
  const result = loading ? null : loaded.page;

  useEffect(() => {
    let active = true;
    void fetchQuestionBank(query).then((response) => {
      if (!active) return;
      if (!response.ok) {
        setLoaded({ key: queryKey, page: null, failed: true });
        return;
      }
      setLoaded({ key: queryKey, page: response.page, failed: false });
      // Bỏ khỏi lựa chọn các câu không còn trên trang.
      setSelected((current) => {
        const visible = new Set(response.page.data.map((item) => item.id));
        return new Set([...current].filter((id) => visible.has(id)));
      });
    });
    return () => {
      active = false;
    };
  }, [query, queryKey]);

  const toggle = useCallback((questionId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }, []);

  const rows = result?.data ?? [];
  const pagination = result?.pagination;
  const targetValue =
    target && targets.some((item) => item.value === target)
      ? target
      : (targets[0]?.value ?? '');
  const selectedIds = [...selected];
  const selectedRoom =
    targets.find((item) => item.value === targetValue)?.room ?? 0;
  const canAdd =
    !busy && selectedIds.length > 0 && targetValue !== '' && selectedRoom > 0;

  return (
    <section className="adm-card tst-bank" aria-labelledby="tst-bank-title">
      <header className="tst-bank__head">
        <h2 id="tst-bank-title">Ngân hàng câu hỏi</h2>
        <span className="tst-chip">{`HSK ${levelCode.replace(/^HSK/u, '')} · Đã xuất bản`}</span>
      </header>

      <div className="tst-bank__filters">
        <label className="tst-field">
          <span>Kỹ năng</span>
          <select
            className="adm-input"
            value={skill}
            onChange={(event) => {
              setSkill(event.target.value);
              setPage(1);
            }}
          >
            {SKILLS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="tst-field">
          <span>Dạng câu</span>
          <select
            className="adm-input"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            {TYPES.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="tst-field tst-field--search">
          <span>Tìm kiếm</span>
          <input
            className="adm-input"
            type="search"
            value={search}
            maxLength={100}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      <div className="tst-bank__actions">
        <label className="tst-field">
          <span>Thêm vào</span>
          <select
            className="adm-input"
            value={targetValue}
            disabled={busy}
            onChange={(event) => setTarget(event.target.value)}
          >
            {targets.length === 0 ? (
              <option value="">Chưa có phần/nhóm</option>
            ) : null}
            {targets.map((item) => (
              <option value={item.value} key={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="adm-btn adm-btn--primary"
          type="button"
          disabled={!canAdd}
          onClick={() => {
            const contents = new Map<number, string>();
            for (const row of rows) {
              if (selected.has(row.id)) contents.set(row.id, row.content);
            }
            onAdd(targetValue, selectedIds, contents);
            setSelected(new Set());
          }}
        >
          {`Thêm ${String(selectedIds.length)} câu vào`}
        </button>
      </div>

      {targetValue === '' ? null : selectedRoom <= 0 ? (
        <p className="adm-muted tst-bank__room-note">
          Nhóm đích đã đủ 50 câu; chọn nhóm khác để thêm.
        </p>
      ) : selectedIds.length > selectedRoom ? (
        <p className="adm-muted tst-bank__room-note">
          {`Nhóm đích chỉ còn ${String(selectedRoom)} chỗ trống.`}
        </p>
      ) : null}

      {error ? (
        <p className="adm-form-error" role="alert">
          Không tải được ngân hàng câu hỏi. Hãy thử lại.
        </p>
      ) : null}

      <div className="tst-bank__scroll">
        <table className="adm-table tst-bank__table">
          <caption className="sr-only">
            Câu hỏi đã xuất bản cùng cấp HSK với đề, trang hiện tại
          </caption>
          <thead>
            <tr>
              <th scope="col" className="tst-bank__check-col">
                Chọn
              </th>
              <th scope="col">ID</th>
              <th scope="col">Nội dung</th>
              <th scope="col">Kỹ năng</th>
              <th scope="col">Dạng</th>
              <th scope="col">Độ khó</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="tst-bank__state" aria-busy="true">
                  Đang tải câu hỏi…
                </td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="tst-bank__state">
                  Không có câu hỏi nào khớp bộ lọc.
                </td>
              </tr>
            ) : null}
            {rows.map((question) => {
              const used = existingIds.has(question.id);
              return (
                <tr
                  key={question.id}
                  className={
                    used ? 'tst-bank__row tst-bank__row--used' : 'tst-bank__row'
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      className="tst-bank__checkbox"
                      checked={selected.has(question.id)}
                      disabled={used}
                      aria-label={
                        used
                          ? `Câu Q${String(question.id)} đã có trong đề`
                          : `Chọn câu Q${String(question.id)}`
                      }
                      onChange={() => toggle(question.id)}
                    />
                  </td>
                  <td className="tst-bank__id">{`Q${String(question.id)}`}</td>
                  <td className="tst-bank__content">
                    <span title={question.content}>{question.content}</span>
                    {used ? (
                      <span className="tst-bank__used">Đã có trong đề</span>
                    ) : null}
                  </td>
                  <td>{skillLabel(question.skill)}</td>
                  <td>{questionTypeLabel(question.type)}</td>
                  <td>{difficultyLabel(question.difficulty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <nav className="tst-pager" aria-label="Phân trang ngân hàng câu hỏi">
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Trang trước
          </button>
          <span>{`Trang ${String(pagination.page)}/${String(pagination.totalPages)} · ${String(pagination.total)} câu`}</span>
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            type="button"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Trang sau
          </button>
        </nav>
      ) : null}
    </section>
  );
}
