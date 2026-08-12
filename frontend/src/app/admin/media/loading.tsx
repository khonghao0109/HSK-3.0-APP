export default function MediaLoading() {
  return (
    <div
      className="page-stack"
      role="status"
      aria-busy="true"
      aria-label="Loading media library"
    >
      <h1 className="sr-only">Loading media library</h1>
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--filters" />
      <div className="content-panel skeleton-table">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton skeleton--row" key={index} />
        ))}
      </div>
    </div>
  );
}
