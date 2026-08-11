import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';

@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new BadRequestException(
        'Validation failed (positive integer expected).',
      );
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > POSTGRESQL_INT4_MAX) {
      throw new BadRequestException(
        'Validation failed (positive integer expected).',
      );
    }
    return parsed;
  }
}
