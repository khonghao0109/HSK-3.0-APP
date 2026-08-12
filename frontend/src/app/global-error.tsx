'use client';

type GlobalErrorRecovery = {
  reset: () => void;
  retry?: () => void;
  unstableRetry?: () => void;
};

export function selectGlobalErrorRecovery({
  reset,
  retry,
  unstableRetry,
}: GlobalErrorRecovery): () => void {
  return unstableRetry ?? retry ?? reset;
}

export default function GlobalError({
  reset,
  retry,
  unstable_retry: unstableRetry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
  unstable_retry?: () => void;
}) {
  const recover = selectGlobalErrorRecovery({ reset, retry, unstableRetry });

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
              onClick={recover}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
