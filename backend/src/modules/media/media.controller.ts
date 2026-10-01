import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../common/pipes/parse-positive-safe-integer.pipe';
import { MediaContentAccessQueryDto } from './dto/media-access-query.dto';
import { MediaAccessService } from './media-access.service';

type AuthenticatedRequest = Request & {
  user: { id: number; role: string };
};

@Controller('media')
export class MediaController {
  constructor(private readonly mediaAccess: MediaAccessService) {}

  @Get(':mediaId/access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @Header('Cache-Control', 'no-store')
  createAccess(
    @Req() request: AuthenticatedRequest,
    @Param('mediaId', ParsePositiveSafeIntegerPipe) mediaId: number,
  ) {
    return this.mediaAccess.createAccess(request.user, mediaId);
  }

  @Get(':mediaId/content')
  @RawResponse()
  @ApiOkResponse({
    description: 'Raw media bytes; errors still use the JSON error envelope.',
    content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
  })
  async getContent(
    @Req() request: Request,
    @Param('mediaId', ParsePositiveSafeIntegerPipe) mediaId: number,
    @Query() query: MediaContentAccessQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const object = await this.mediaAccess.readSignedObject(
      mediaId,
      query.expires,
      query.signature,
      {
        method: request.method,
        path: request.originalUrl.split('?', 1)[0] ?? '',
      },
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', object.contentType);
    response.setHeader('Content-Length', String(object.size));
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(object.body);
  }
}
