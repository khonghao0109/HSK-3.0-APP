import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { ApiEnvelope } from '../../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../../common/openapi/openapi.constants';
import { LearningPathResponseDto } from './dto/learning-path-response.dto';
import { LearningPathService } from './learning-path.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('learning')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class LearningPathController {
  constructor(private readonly pathService: LearningPathService) {}

  @Get('path')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(LearningPathResponseDto)
  getPath(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiSuccessResponse<LearningPathResponseDto>> {
    return this.pathService.getPath(request.user.id);
  }
}
