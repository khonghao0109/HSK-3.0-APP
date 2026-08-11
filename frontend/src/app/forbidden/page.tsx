import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="state-page">
      <div className="state-card">
        <span className="state-card__code mono">403</span>
        <div className="state-card__mark" aria-hidden="true">
          界
        </div>
        <h1>Access restricted</h1>
        <p>This workspace is limited to active HSK content administrators.</p>
        <Link className="button button--primary" href="/login">
          Return to sign in
        </Link>
      </div>
    </main>
  );
}
