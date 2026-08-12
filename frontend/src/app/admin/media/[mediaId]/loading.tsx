export default function MediaDetailLoading() {
  return (
    <div
      className="page-stack"
      role="status"
      aria-busy="true"
      aria-label="Loading media detail"
    >
      <h1 className="sr-only">Loading media detail</h1>
      <div className="skeleton skeleton--title" />
      <div className="detail-grid">
        <div className="panel skeleton-table">
          <div className="skeleton skeleton--row" />
          <div className="skeleton skeleton--row" />
        </div>
        <div className="panel skeleton-table">
          <div className="skeleton skeleton--row" />
          <div className="skeleton skeleton--row" />
        </div>
      </div>
    </div>
  );
}
