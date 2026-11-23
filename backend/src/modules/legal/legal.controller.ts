import { Controller, Get, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';

import { ConsentService } from './consent.service';
import { CurrentLegalDocumentDto } from './dto/consent.dto';

/** Public read, fixed in every environment like the course reads. */
export const LEGAL_READ_LIMIT_PER_MINUTE = 60;

export function legalReadLimit(): number {
  return LEGAL_READ_LIMIT_PER_MINUTE;
}

/** M1.7b2: public, no JWT. */
@Controller('legal')
export class LegalController {
  constructor(private readonly consentService: ConsentService) {}

  /** Current version of each legal document; empty until one is registered. */
  @Get('documents/current')
  @Throttle({ default: { limit: legalReadLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope([CurrentLegalDocumentDto])
  getCurrentDocuments(): Promise<CurrentLegalDocumentDto[]> {
    return this.consentService.getCurrentDocuments();
  }
}
