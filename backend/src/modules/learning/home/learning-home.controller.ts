import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { ApiEnvelope } from '../../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../../common/openapi/openapi.constants';
import { LearningHomeResponseDto } from './dto/learning-home-response.dto';
import { LearningHomeService } from './learning-home.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('learning')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class LearningHomeController {
  constructor(private readonly homeService: LearningHomeService) {}

  @Get('home')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(LearningHomeResponseDto)
  getHome(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiSuccessResponse<LearningHomeResponseDto>> {
    return this.homeService.getHome(request.user.id, new Date());
  }
}
