export default function ExerciseDetailLoading() {
  return (
    <div
      className="page-stack"
      role="status"
      aria-busy="true"
      aria-label="Loading exercise detail"
    >
      <h1 className="sr-only">Loading exercise detail</h1>
      <div className="skeleton skeleton--title" />
      <div className="detail-grid">
        <div className="panel skeleton skeleton--detail" />
        <div className="panel skeleton skeleton--detail" />
      </div>
    </div>
  );
}
