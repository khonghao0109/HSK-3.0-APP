import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../common/pipes/parse-positive-safe-integer.pipe';
import { MediaContentAccessQueryDto } from './dto/media-access-query.dto';
import { MediaAccessService } from './media-access.service';
import {
  grantTracker,
  mediaAccessLimit,
  mediaContentGrantLimit,
} from './media-content-throttle';

type AuthenticatedRequest = Request & {
  user: { id: number; role: string };
};

@Controller('media')
export class MediaController {
  constructor(private readonly mediaAccess: MediaAccessService) {}

  @Get(':mediaId/access')
  @Throttle({ default: { limit: mediaAccessLimit, ttl: 60_000 } })
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
  @Throttle({
    default: {
      limit: mediaContentGrantLimit,
      ttl: 60_000,
      getTracker: grantTracker,
    },
  })
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
    // shortcut: mỗi Range request đọc lại và băm lại toàn bộ object; ổn với clip HSK ngắn, xem lại nếu audio lớn
    const range = request.range(object.size);
    // range-parser returns -1 for any unit; only a bytes range is unsatisfiable.
    if (range === -1 && /^bytes=/iu.test(request.get('Range') ?? '')) {
      response.setHeader('Content-Range', `bytes */${object.size}`);
      throw new HttpException(
        {
          code: 'MEDIA_RANGE_NOT_SATISFIABLE',
          message: 'Requested range is not satisfiable.',
        },
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }
    // Safari needs a single byte range; malformed or multi-range requests get the whole file.
    const single =
      Array.isArray(range) && range.type === 'bytes' && range.length === 1
        ? range[0]
        : undefined;
    response.setHeader('Content-Type', object.contentType);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Accept-Ranges', 'bytes');
    if (single) {
      response.status(HttpStatus.PARTIAL_CONTENT);
      response.setHeader(
        'Content-Range',
        `bytes ${single.start}-${single.end}/${object.size}`,
      );
      response.setHeader(
        'Content-Length',
        String(single.end - single.start + 1),
      );
      response.end(object.body.subarray(single.start, single.end + 1));
      return;
    }
    response.setHeader('Content-Length', String(object.size));
    response.end(object.body);
  }
}
