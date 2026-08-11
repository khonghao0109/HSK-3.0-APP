import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import { POSTGRESQL_INT4_MAX } from '../constants/database.constants';

@Injectable()
export class ParsePositiveSafeIntegerPipe implements PipeTransform<
  string,
  number
> {
  transform(value: string): number {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new BadRequestException('Path id must be a positive safe integer.');
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > POSTGRESQL_INT4_MAX) {
      throw new BadRequestException('Path id must be a positive safe integer.');
    }
    return parsed;
  }
}
