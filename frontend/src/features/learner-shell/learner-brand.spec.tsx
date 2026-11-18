import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LearnerBrand } from './learner-brand';

describe('LearnerBrand', () => {
  it('renders the 汉 mark and "Hán Lộ" as a link to the given href', () => {
    render(<LearnerBrand href="/" />);
    const link = screen.getByRole('link', { name: 'Hán Lộ' });
    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveClass('w-brand');
    expect(screen.getByText('汉')).toHaveClass('w-brand__mark');
    expect(screen.getByText('Hán Lộ')).toHaveClass('w-brand__name');
  });

  it('keeps the mark out of the accessible name (decorative)', () => {
    render(<LearnerBrand href="/learn" />);
    const link = screen.getByRole('link', { name: 'Hán Lộ' });
    expect(link.querySelector('.w-brand__mark')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('appends the extra class when given one', () => {
    render(<LearnerBrand href="/" className="lp-foot" />);
    expect(screen.getByRole('link', { name: 'Hán Lộ' })).toHaveClass(
      'w-brand',
      'lp-foot',
    );
  });
});
