import Link from 'next/link';

import { levelLabel } from '@/features/admin-shell/admin-labels';

import type { QuestionQuery } from './question-query';
import {
  QUESTION_DIFFICULTY_OPTIONS,
  QUESTION_SKILL_OPTIONS,
  QUESTION_STATUS_OPTIONS,
  QUESTION_TYPE_OPTIONS,
  type QuestionTagSuggestion,
} from './question-values';

/**
 * Hàng filter trang Ngân hàng câu hỏi (TL-89): mọi filter nằm trên URL search
 * params, form GET thuần server component; nút "Bộ lọc" là disclosure
 * `<details>` mở thêm filter Trạng thái.
 */
export function QuestionFilters({
  query,
  levels,
  tags,
}: {
  query: QuestionQuery;
  levels: Array<{ id: number; code: string }>;
  tags: QuestionTagSuggestion[];
}) {
  // TL-82b: URL có thể mang nhiều tag (từ cột "Ngân hàng"). Dropdown chỉ chọn
  // một, nên khi đang lọc nhiều tag nó hiện "Tất cả chủ đề" như yêu cầu F3.
  const selectedTag = query.tag?.length === 1 ? query.tag[0] : '';
  return (
    <form
      className="adm-filters qn-filters"
      method="get"
      action="/admin/questions"
      role="search"
      aria-label="Lọc ngân hàng câu hỏi"
    >
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="limit" value={query.limit} />
      <label className="sr-only" htmlFor="qn-level">
        Cấp độ HSK
      </label>
      <select
        className="adm-input"
        id="qn-level"
        name="levelId"
        defaultValue={query.levelId ? String(query.levelId) : ''}
      >
        <option value="">Tất cả HSK</option>
        {levels.map((level) => (
          <option key={level.id} value={level.id}>
            {levelLabel(level.code)}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="qn-skill">
        Kỹ năng
      </label>
      <select
        className="adm-input"
        id="qn-skill"
        name="skill"
        defaultValue={query.skill ?? ''}
      >
        <option value="">Tất cả kỹ năng</option>
        {QUESTION_SKILL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="qn-tag">
        Chủ đề
      </label>
      <select
        className="adm-input"
        id="qn-tag"
        name="tag"
        defaultValue={selectedTag}
      >
        <option value="">Tất cả chủ đề</option>
        {selectedTag && !tags.some((tag) => tag.slug === selectedTag) ? (
          <option value={selectedTag}>{selectedTag}</option>
        ) : null}
        {tags.map((tag) => (
          <option key={tag.slug} value={tag.slug}>
            {tag.name}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="qn-difficulty">
        Độ khó
      </label>
      <select
        className="adm-input"
        id="qn-difficulty"
        name="difficulty"
        defaultValue={query.difficulty ? String(query.difficulty) : ''}
      >
        {QUESTION_DIFFICULTY_OPTIONS.map((option) => (
          <option key={option.value || 'all'} value={option.value}>
            {option.value === '' ? 'Tất cả độ khó' : option.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="qn-type">
        Loại câu hỏi
      </label>
      <select
        className="adm-input"
        id="qn-type"
        name="type"
        defaultValue={query.type ?? ''}
      >
        <option value="">Tất cả loại câu hỏi</option>
        {QUESTION_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="qn-q">
        Tìm kiếm nội dung câu hỏi
      </label>
      <input
        className="adm-input qn-filters__search"
        id="qn-q"
        name="q"
        type="search"
        maxLength={100}
        defaultValue={query.q ?? ''}
        placeholder="Tìm nội dung câu hỏi"
      />

      <details className="qn-filters__more">
        <summary className="adm-btn adm-btn--ghost">Bộ lọc</summary>
        <div className="qn-filters__more-body">
          <label className="qn-filters__label" htmlFor="qn-status">
            Trạng thái
          </label>
          <select
            className="adm-input"
            id="qn-status"
            name="status"
            defaultValue={query.status ?? ''}
          >
            <option value="">Tất cả trạng thái</option>
            {QUESTION_STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
      </details>

      <button className="adm-btn adm-btn--primary" type="submit">
        Lọc
      </button>
      <Link className="adm-btn adm-btn--ghost" href="/admin/questions">
        Xoá lọc
      </Link>
    </form>
  );
}
