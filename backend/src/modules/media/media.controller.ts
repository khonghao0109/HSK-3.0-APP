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
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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
  @Header('Cache-Control', 'no-store')
  createAccess(
    @Req() request: AuthenticatedRequest,
    @Param('mediaId', ParsePositiveSafeIntegerPipe) mediaId: number,
  ) {
    return this.mediaAccess.createAccess(request.user, mediaId);
  }

  @Get(':mediaId/content')
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
