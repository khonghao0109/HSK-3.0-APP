export default function ExerciseDetailLoading() {
  return (
    <div
      className="page-stack"
      aria-busy="true"
      aria-label="Loading exercise detail"
    >
      <div className="skeleton skeleton--title" />
      <div className="detail-grid">
        <div className="panel skeleton skeleton--detail" />
        <div className="panel skeleton skeleton--detail" />
      </div>
    </div>
  );
}
