import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

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
    if (!Number.isSafeInteger(parsed)) {
      throw new BadRequestException('Path id must be a positive safe integer.');
    }
    return parsed;
  }
}
