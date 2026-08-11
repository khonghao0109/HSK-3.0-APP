import { BadRequestException } from '@nestjs/common';

import { ParsePositiveIntPipe } from './parse-positive-int.pipe';

describe('ParsePositiveIntPipe', () => {
  const pipe = new ParsePositiveIntPipe();

  it('accepts a positive safe integer', () => {
    expect(pipe.transform('42')).toBe(42);
  });

  it.each(['0', '-1', '1.5', 'abc', '9007199254740992'])(
    'rejects invalid content id %s',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
