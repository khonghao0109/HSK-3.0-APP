import Link from 'next/link';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import {
  exerciseStatusLabel,
  exerciseTypeLabel,
} from '@/features/admin-shell/admin-labels';

import type { AdminExercise } from './exercise-contract';

export function ExerciseTable({ exercises }: { exercises: AdminExercise[] }) {
  if (exercises.length === 0) {
    return (
      <div className="adm-empty" role="status">
        <AdminIcon name="search" />
        <p>Không có bài tập nào khớp bộ lọc.</p>
        <Link
          className="adm-btn adm-btn--outline adm-btn--sm"
          href="/admin/exercises"
        >
          Xoá lọc
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="adm-table-wrap adm-table-wrap--swap">
        <table className="adm-table">
          <caption className="sr-only">
            Danh sách bài tập, trang hiện tại
          </caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Bài tập</th>
              <th scope="col">Vị trí</th>
              <th scope="col">Loại</th>
              <th scope="col">Phiên bản</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {exercises.map((exercise) => (
              <tr key={exercise.id} aria-label={`Bài tập ${exercise.id}`}>
                <td>
                  <span className="adm-mono">EX-{exercise.id}</span>
                </td>
                <td>
                  <span className="adm-table__strong">{exercise.prompt}</span>
                  <span className="adm-table__sub">
                    Thứ tự {exercise.orderIndex}
                  </span>
                </td>
                <td>
                  <span>{exercise.lesson.title}</span>
                  <span className="adm-table__sub">
                    {exercise.topic?.title ?? 'Cấp bài học'}
                  </span>
                </td>
                <td>{exerciseTypeLabel(exercise.type)}</td>
                <td>
                  <span className="adm-mono">v{exercise.version}</span>
                </td>
                <td>
                  <AdminBadge
                    status={exercise.status}
                    label={exerciseStatusLabel(exercise.status)}
                  />
                </td>
                <td>
                  <Link
                    className="adm-link"
                    href={`/admin/exercises/${exercise.id}`}
                  >
                    Mở bài tập {exercise.id}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol
        className="adm-record-list adm-record-list--swap"
        aria-label="Danh sách bài tập cho màn hẹp"
      >
        {exercises.map((exercise) => (
          <li key={exercise.id} aria-label={`Bài tập ${exercise.id}`}>
            <div className="adm-record-list__head">
              <div>
                <span className="adm-mono">EX-{exercise.id}</span>
                <strong>{exercise.prompt}</strong>
              </div>
              <AdminBadge
                status={exercise.status}
                label={exerciseStatusLabel(exercise.status)}
              />
            </div>
            <dl className="adm-record-list__facts">
              <div>
                <dt>Vị trí</dt>
                <dd>
                  {exercise.lesson.title}
                  <span className="adm-table__sub">
                    {exercise.topic?.title ?? 'Cấp bài học'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Loại</dt>
                <dd>{exerciseTypeLabel(exercise.type)}</dd>
              </div>
              <div>
                <dt>Phiên bản</dt>
                <dd className="adm-mono">v{exercise.version}</dd>
              </div>
              <div>
                <dt>Thứ tự</dt>
                <dd className="adm-mono">{exercise.orderIndex}</dd>
              </div>
            </dl>
            <Link className="adm-link" href={`/admin/exercises/${exercise.id}`}>
              Mở bài tập {exercise.id}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
