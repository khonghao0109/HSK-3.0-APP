import { BadRequestException } from '@nestjs/common';

import { ParsePositiveSafeIntegerPipe } from './parse-positive-safe-integer.pipe';

describe('ParsePositiveSafeIntegerPipe', () => {
  const pipe = new ParsePositiveSafeIntegerPipe();

  it('accepts a positive safe integer', () => {
    expect(pipe.transform('42')).toBe(42);
  });

  it.each(['0', '-1', '1.2', '01', 'abc', '2147483648', '9007199254740992'])(
    'rejects invalid path id %s',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
