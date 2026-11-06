export default function ExerciseLoading() {
  return (
    <div
      className="adm-page-stack"
      role="status"
      aria-busy="true"
      aria-label="Đang tải bài tập"
    >
      <h1 className="sr-only">Đang tải bài tập</h1>
      <div className="adm-skeleton adm-skeleton--title" />
      <div className="adm-detail-grid">
        <div className="adm-skeleton adm-skeleton--panel" />
        <div className="adm-skeleton adm-skeleton--panel" />
      </div>
    </div>
  );
}
