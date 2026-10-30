import Link from 'next/link';

import {
  exerciseStatusLabel,
  exerciseTypeLabel,
} from '@/features/admin-shell/admin-labels';

import { exerciseStatuses, exerciseTypes } from './exercise-contract';
import type { ExerciseQuery } from './exercise-query';

export function ExerciseFilters({ query }: { query: ExerciseQuery }) {
  return (
    <form
      className="adm-filters"
      method="get"
      action="/admin/exercises"
      role="search"
      aria-label="Lọc bài tập"
    >
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="limit" value={query.limit} />
      <label className="sr-only" htmlFor="status">
        Trạng thái
      </label>
      <select
        className="adm-input"
        id="status"
        name="status"
        defaultValue={query.status ?? ''}
      >
        <option value="">Tất cả trạng thái</option>
        {exerciseStatuses.map((status) => (
          <option key={status} value={status}>
            {exerciseStatusLabel(status)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="type">
        Loại bài tập
      </label>
      <select
        className="adm-input"
        id="type"
        name="type"
        defaultValue={query.type ?? ''}
      >
        <option value="">Tất cả loại bài tập</option>
        {exerciseTypes.map((type) => (
          <option key={type} value={type}>
            {exerciseTypeLabel(type)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="lessonId">
        ID bài học
      </label>
      <input
        className="adm-input"
        id="lessonId"
        name="lessonId"
        type="number"
        min="1"
        defaultValue={query.lessonId}
        placeholder="ID bài học"
      />
      <label className="sr-only" htmlFor="topicId">
        ID chủ đề
      </label>
      <input
        className="adm-input"
        id="topicId"
        name="topicId"
        type="number"
        min="1"
        defaultValue={query.topicId}
        placeholder="ID chủ đề"
      />
      <button className="adm-btn adm-btn--primary" type="submit">
        Lọc
      </button>
      <Link className="adm-btn adm-btn--ghost" href="/admin/exercises">
        Xoá lọc
      </Link>
    </form>
  );
}
