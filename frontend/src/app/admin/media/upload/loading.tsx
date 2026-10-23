export default function MediaUploadLoading() {
  return (
    <div
      className="adm-page-stack"
      role="status"
      aria-busy="true"
      aria-label="Đang tải trang tải media"
    >
      <h1 className="sr-only">Đang tải trang tải media</h1>
      <div className="adm-skeleton adm-skeleton--title" />
      <div className="adm-card adm-panel">
        <div className="adm-skeleton adm-skeleton--filters" />
        <div className="adm-skeleton adm-skeleton--row" />
        <div className="adm-skeleton adm-skeleton--row" />
      </div>
    </div>
  );
}
