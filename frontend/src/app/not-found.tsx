import Link from 'next/link';

export default function GlobalNotFound() {
  return (
    <main className="state-page">
      <div className="state-card">
        <span className="state-card__code mono">404</span>
        <div className="state-card__mark" aria-hidden="true">
          空
        </div>
        <h1>Page not found</h1>
        <p>The requested workspace does not exist.</p>
        <Link className="button button--primary" href="/admin/exercises">
          Open exercises
        </Link>
      </div>
    </main>
  );
}
