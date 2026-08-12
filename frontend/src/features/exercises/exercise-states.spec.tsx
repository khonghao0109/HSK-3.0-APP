import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ExercisesError from '@/app/admin/exercises/error';
import ExercisesLoading from '@/app/admin/exercises/loading';

describe('Exercise route states', () => {
  it('announces the loading skeleton without exposing stale data', () => {
    render(<ExercisesLoading />);
    expect(screen.getByLabelText('Loading exercises')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: 'Loading exercises', level: 1 }),
    ).toBeInTheDocument();
  });

  it('renders a safe retry state without reflecting the raw error', () => {
    const secret = 'postgresql://admin:password@production/hsk';
    render(<ExercisesError error={new Error(secret)} reset={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    expect(document.body.textContent).not.toContain(secret);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
