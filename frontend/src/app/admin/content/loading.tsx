export default function ContentLoading() {
  return (
    <div
      className="adm-page-stack"
      role="status"
      aria-busy="true"
      aria-label="Đang tải nội dung"
    >
      <h1 className="sr-only">Đang tải nội dung</h1>
      <div className="adm-skeleton adm-skeleton--title" />
      <div className="adm-skeleton adm-skeleton--filters" />
      <div className="adm-card adm-panel">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="adm-skeleton adm-skeleton--row" key={index} />
        ))}
      </div>
    </div>
  );
}
