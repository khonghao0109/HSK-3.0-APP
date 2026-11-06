export default function MediaIngestionsLoading() {
  return (
    <div
      className="adm-page-stack"
      role="status"
      aria-busy="true"
      aria-label="Đang tải danh sách tải lên cần xử lý"
    >
      <h1 className="sr-only">Đang tải danh sách tải lên cần xử lý</h1>
      <div className="adm-skeleton adm-skeleton--title" />
      <div className="adm-card adm-panel">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="adm-skeleton adm-skeleton--row" key={index} />
        ))}
      </div>
    </div>
  );
}
