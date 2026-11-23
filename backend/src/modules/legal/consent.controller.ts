import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';

import { ConsentService } from './consent.service';
import {
  AcceptDocumentsDto,
  OptionalConsentStateDto,
  OptionalConsentTypeParamDto,
  SetOptionalConsentDto,
  UserConsentsResponseDto,
} from './dto/consent.dto';

/** Consent writes, fixed in every environment. */
export const CONSENT_WRITE_LIMIT_PER_MINUTE = 20;

export function consentWriteLimit(): number {
  return CONSENT_WRITE_LIMIT_PER_MINUTE;
}

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

/**
 * M1.7b2 (Q189, Q190, Q193): the caller's own consents only. There is no
 * route to withdraw `terms`/`privacy`; that goes through account deletion.
 */
@Controller('users/me/consents')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(UserConsentsResponseDto)
  getConsents(
    @Req() request: AuthenticatedRequest,
  ): Promise<UserConsentsResponseDto> {
    return this.consentService.getUserConsents(request.user.id);
  }

  /** Re-consent to registered document versions; repeating is a no-op. */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: consentWriteLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(UserConsentsResponseDto)
  acceptDocuments(
    @Req() request: AuthenticatedRequest,
    @Body() dto: AcceptDocumentsDto,
  ): Promise<UserConsentsResponseDto> {
    return this.consentService.acceptDocuments(request.user.id, dto.documents);
  }

  @Put('optional/:type')
  @Throttle({ default: { limit: consentWriteLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(OptionalConsentStateDto)
  setOptionalConsent(
    @Req() request: AuthenticatedRequest,
    @Param() params: OptionalConsentTypeParamDto,
    @Body() dto: SetOptionalConsentDto,
  ): Promise<OptionalConsentStateDto> {
    return this.consentService.setOptionalConsent(
      request.user.id,
      params.type,
      dto.granted,
    );
  }
}
