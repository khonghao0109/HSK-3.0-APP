import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../common/pipes/parse-positive-safe-integer.pipe';
import { DictionaryService } from './dictionary.service';
import {
  DictionaryWordDetailDto,
  DictionaryWordSavedDto,
  DictionaryWordSaveResultDto,
} from './dto/dictionary-word-response.dto';

export const WORD_SAVE_LIMIT_PER_MINUTE = 60;

export function wordSaveLimit(): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : WORD_SAVE_LIMIT_PER_MINUTE;
}

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get()
  async search(@Query('query') query: string) {
    return this.dictionaryService.search(query);
  }

  @Get('words/:id')
  @ApiEnvelope(DictionaryWordDetailDto)
  getWord(@Param('id', ParsePositiveSafeIntegerPipe) id: number) {
    return this.dictionaryService.getWord(id);
  }

  @Get('words/:id/save')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @ApiEnvelope(DictionaryWordSavedDto)
  getSaved(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParsePositiveSafeIntegerPipe) id: number,
  ) {
    return this.dictionaryService.getSaved(request.user.id, id);
  }

  @Post('words/:id/save')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @Throttle({ default: { limit: wordSaveLimit, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Replaying a key with the same request returns the original result.',
  })
  @ApiEnvelope(DictionaryWordSaveResultDto)
  saveWord(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParsePositiveSafeIntegerPipe) id: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.dictionaryService.saveWord(request.user.id, id, idempotencyKey);
  }

  @Delete('words/:id/save')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @Throttle({ default: { limit: wordSaveLimit, ttl: 60_000 } })
  @ApiEnvelope(DictionaryWordSavedDto)
  unsaveWord(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParsePositiveSafeIntegerPipe) id: number,
  ) {
    return this.dictionaryService.unsaveWord(request.user.id, id);
  }
}
