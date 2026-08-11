import Link from 'next/link';

import { StatusBadge } from '@/components/ui/status-badge';

import type { AdminExercise } from './exercise-contract';

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function ExerciseTable({ exercises }: { exercises: AdminExercise[] }) {
  if (exercises.length === 0) {
    return (
      <div className="empty-state" role="status">
        <span className="empty-state__mark" aria-hidden="true">
          练
        </span>
        <h2>No exercises match</h2>
        <p>
          Adjust the filters or clear them to return to the full content queue.
        </p>
      </div>
    );
  }
  return (
    <div className="table-frame">
      <table className="exercise-table">
        <caption className="sr-only">
          Lesson exercises in the content repository
        </caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Exercise</th>
            <th scope="col">Placement</th>
            <th scope="col">Type</th>
            <th scope="col">Version</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {exercises.map((exercise) => (
            <tr key={exercise.id} aria-label={`Exercise ${exercise.id}`}>
              <td data-label="ID">
                <span className="mono">EX-{exercise.id}</span>
              </td>
              <td data-label="Exercise">
                <strong>{exercise.prompt}</strong>
                <span className="table-subline mono">
                  Order {exercise.orderIndex}
                </span>
              </td>
              <td data-label="Placement">
                <span>{exercise.lesson.title}</span>
                <span className="table-subline">
                  {exercise.topic?.title ?? 'Lesson level'}
                </span>
              </td>
              <td data-label="Type">{titleCase(exercise.type)}</td>
              <td data-label="Version">
                <span className="mono">v{exercise.version}</span>
              </td>
              <td data-label="Status">
                <StatusBadge status={exercise.status}>
                  {titleCase(exercise.status)}
                </StatusBadge>
              </td>
              <td data-label="Open">
                <Link
                  className="row-link"
                  href={`/admin/exercises/${exercise.id}`}
                >
                  Open exercise {exercise.id}
                  <span aria-hidden="true"> →</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
