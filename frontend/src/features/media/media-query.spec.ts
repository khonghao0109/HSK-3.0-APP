import { describe, expect, it } from 'vitest';

import {
  parseMediaQuery,
  serializeMediaQuery,
  withMediaPage,
} from './media-query';

describe('Media URL query contract', () => {
  it('normalizes allowlisted filters and bounded pagination', () => {
    expect(
      parseMediaQuery({
        page: '2',
        limit: '50',
        type: 'audio',
        processingStatus: 'ready',
        lifecycle: 'active',
        dataSourceId: '7',
      }),
    ).toEqual({
      page: 2,
      limit: 50,
      type: 'audio',
      processingStatus: 'ready',
      lifecycle: 'active',
      dataSourceId: 7,
    });
  });

  it('drops unknown filters and serializes a canonical URL', () => {
    const query = parseMediaQuery({
      page: '-1',
      limit: '1000',
      type: 'executable',
      processingStatus: 'published',
      lifecycle: 'deleted',
      dataSourceId: '0',
    });
    expect(query).toEqual({ page: 1, limit: 20 });
    expect(serializeMediaQuery(query).toString()).toBe('page=1&limit=20');
    expect(withMediaPage(query, 3)).toBe('?page=3&limit=20');
  });
});
