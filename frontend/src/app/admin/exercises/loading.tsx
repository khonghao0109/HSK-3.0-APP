export default function ExercisesLoading() {
  return (
    <div className="page-stack" aria-busy="true" aria-label="Loading exercises">
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
