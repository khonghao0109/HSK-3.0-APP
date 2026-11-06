import Link from 'next/link';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  contentStatusLabel,
  revisionReviewStateLabel,
  revisionReviewStateTone,
  topicTypeLabel,
} from '@/features/admin-shell/admin-labels';

import type { TopicListItem } from './content-contract';

/**
 * Bảng "Chủ đề của bài" ở trang chi tiết lesson (M5.1a, Q91) — đọc-only;
 * sửa topic ở trang topic riêng. Server component thuần; `TopicListItem`
 * qua import type để không kéo Zod contract vào đồ thị render.
 */
export function LessonTopics({ topics }: { topics: TopicListItem[] }) {
  if (topics.length === 0) {
    return <p className="adm-muted">Chưa có chủ đề nào.</p>;
  }
  return (
    <>
      <div className="adm-table-wrap adm-table-wrap--swap">
        <table className="adm-table">
          <caption className="sr-only">Danh sách chủ đề của bài học</caption>
          <thead>
            <tr>
              <th scope="col">Thứ tự</th>
              <th scope="col">Tiêu đề</th>
              <th scope="col">Loại</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Trạng thái duyệt</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic) => (
              <tr key={topic.id}>
                <td>
                  <span className="adm-mono">{topic.orderIndex}</span>
                </td>
                <td>
                  <Link
                    className="adm-link"
                    href={`/admin/content/topics/${topic.id}`}
                  >
                    {topic.title}
                  </Link>
                </td>
                <td>{topicTypeLabel(topic.type)}</td>
                <td>
                  <AdminBadge
                    status={topic.status}
                    label={contentStatusLabel(topic.status)}
                  />
                </td>
                <td>
                  {topic.latestRevision ? (
                    <AdminBadge
                      tone={revisionReviewStateTone(topic.latestRevision)}
                      label={revisionReviewStateLabel(topic.latestRevision)}
                    />
                  ) : (
                    <span className="adm-muted">
                      {revisionReviewStateLabel(null)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* R7: ≤ 900px bảng đổi sang thẻ như content-table. */}
      <ol
        className="adm-record-list adm-record-list--swap adm-lesson-topics__cards"
        aria-label="Danh sách chủ đề cho màn hẹp"
      >
        {topics.map((topic) => (
          <li key={topic.id} aria-label={`Chủ đề ${topic.title}`}>
            <div className="adm-record-list__head">
              <Link
                className="adm-link adm-lesson-topics__link"
                href={`/admin/content/topics/${topic.id}`}
              >
                {topic.title}
              </Link>
              <AdminBadge
                status={topic.status}
                label={contentStatusLabel(topic.status)}
              />
            </div>
            <dl className="adm-record-list__facts">
              <div>
                <dt>Thứ tự</dt>
                <dd className="adm-mono">{topic.orderIndex}</dd>
              </div>
              <div>
                <dt>Loại</dt>
                <dd>{topicTypeLabel(topic.type)}</dd>
              </div>
              <div>
                <dt>Trạng thái duyệt</dt>
                <dd>
                  {topic.latestRevision ? (
                    <AdminBadge
                      tone={revisionReviewStateTone(topic.latestRevision)}
                      label={revisionReviewStateLabel(topic.latestRevision)}
                    />
                  ) : (
                    revisionReviewStateLabel(null)
                  )}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}
