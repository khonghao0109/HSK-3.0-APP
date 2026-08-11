'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="state-page">
          <div className="state-card">
            <div className="state-card__mark" aria-hidden="true">
              !
            </div>
            <h1>Console unavailable</h1>
            <p>An unexpected problem interrupted the workspace.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={reset}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
