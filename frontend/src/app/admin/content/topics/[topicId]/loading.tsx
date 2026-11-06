export default function TopicDetailLoading() {
  return (
    <div
      className="adm-page-stack"
      role="status"
      aria-busy="true"
      aria-label="Đang tải chủ đề"
    >
      <h1 className="sr-only">Đang tải chủ đề</h1>
      <div className="adm-skeleton adm-skeleton--title" />
      <div className="adm-detail-grid">
        <div className="adm-skeleton adm-skeleton--panel" />
        <div className="adm-skeleton adm-skeleton--panel" />
      </div>
    </div>
  );
}
