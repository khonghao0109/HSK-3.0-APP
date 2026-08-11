import Link from 'next/link';

export default function ExerciseNotFound() {
  return (
    <div className="inline-error">
      <span className="inline-error__mark" aria-hidden="true">
        ?
      </span>
      <div>
        <p className="eyebrow">NOT FOUND</p>
        <h1>Exercise unavailable</h1>
        <p>It may not exist or may no longer be accessible.</p>
        <Link className="button button--primary" href="/admin/exercises">
          Back to exercises
        </Link>
      </div>
    </div>
  );
}
