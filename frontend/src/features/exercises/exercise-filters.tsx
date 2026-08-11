import Link from 'next/link';

import { exerciseStatuses, exerciseTypes } from './exercise-contract';
import type { ExerciseQuery } from './exercise-query';

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function ExerciseFilters({ query }: { query: ExerciseQuery }) {
  return (
    <form className="filter-bar" method="get" action="/admin/exercises">
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="limit" value={query.limit} />
      <div className="field-inline">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={query.status ?? ''}>
          <option value="">All statuses</option>
          {exerciseStatuses.map((status) => (
            <option key={status} value={status}>
              {label(status)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-inline">
        <label htmlFor="type">Type</label>
        <select id="type" name="type" defaultValue={query.type ?? ''}>
          <option value="">All types</option>
          {exerciseTypes.map((type) => (
            <option key={type} value={type}>
              {label(type)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-inline field-inline--short">
        <label htmlFor="lessonId">Lesson ID</label>
        <input
          id="lessonId"
          name="lessonId"
          type="number"
          min="1"
          defaultValue={query.lessonId}
          placeholder="Any"
        />
      </div>
      <div className="field-inline field-inline--short">
        <label htmlFor="topicId">Topic ID</label>
        <input
          id="topicId"
          name="topicId"
          type="number"
          min="1"
          defaultValue={query.topicId}
          placeholder="Any"
        />
      </div>
      <button className="button button--primary" type="submit">
        Apply filters
      </button>
      <Link className="button button--ghost" href="/admin/exercises">
        Clear
      </Link>
    </form>
  );
}
