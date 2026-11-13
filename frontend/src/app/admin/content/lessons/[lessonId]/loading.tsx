export default function LessonDetailLoading() {
  return (
    <div
      className="adm-page-stack"
      role="status"
      aria-busy="true"
      aria-label="Đang tải chi tiết bài học"
    >
      <h1 className="sr-only">Đang tải chi tiết bài học</h1>
      <div className="adm-skeleton adm-skeleton--title" />
      <div className="adm-detail-grid">
        <div className="adm-skeleton adm-skeleton--panel" />
        <div className="adm-skeleton adm-skeleton--panel" />
      </div>
    </div>
  );
}
