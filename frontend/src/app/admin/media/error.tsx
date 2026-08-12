'use client';

export default function MediaError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="inline-error" role="alert">
      <span className="inline-error__mark" aria-hidden="true">
        !
      </span>
      <div>
        <p className="eyebrow">SERVICE INTERRUPTION</p>
        <h1>Media library could not be loaded</h1>
        <p>
          The console received an invalid or unavailable response. No provider
          details were exposed.
        </p>
        <button
          className="button button--primary"
          type="button"
          onClick={reset}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
