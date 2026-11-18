import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MediaUploadLink } from './media-upload-link';

describe('MediaUploadLink (TL-43, Q104)', () => {
  it('links to the upload page when ingestion is enabled', () => {
    render(<MediaUploadLink enabled />);
    const link = screen.getByRole('link', { name: 'Tải lên' });
    expect(link).toHaveAttribute('href', '/admin/media/upload');
    expect(link).toHaveClass('adm-btn', 'adm-btn--primary');
  });

  it('renders nothing when ingestion is disabled', () => {
    const { container } = render(<MediaUploadLink enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
