import { randomUUID } from 'node:crypto';

import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { isAcceptedRequestId } from '../../common/middleware/request-id.middleware';
import { RolesGuard } from '../../common/guards/roles.guard';

import { CmsActor } from './cms-workflow';
import { CmsService } from './cms.service';
import { AdminExercisesQueryDto } from './dto/admin-exercises-query.dto';
import { AdminLessonsQueryDto } from './dto/admin-lessons-query.dto';
import { AdminMediaQueryDto } from './dto/admin-media-query.dto';
import { CreateExerciseRevisionDto } from './dto/create-exercise-revision.dto';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import {
  CommitExerciseImportDto,
  PreviewExerciseImportDto,
} from './dto/exercise-import.dto';
import { CreateLessonRevisionDto } from './dto/create-lesson-revision.dto';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { CreateTopicRevisionDto } from './dto/create-topic-revision.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { ReviewRevisionDto } from './dto/review-revision.dto';
import { MediaIngestionQueryDto } from './dto/media-ingestion-query.dto';
import { ExerciseAuthoringService } from './exercise-authoring.service';
import { ExerciseImportService } from './exercise-import/exercise-import.service';
import { MediaAdminService } from './media-admin.service';
import {
  MEDIA_UPLOAD_MAX_BYTES,
  MediaIngestionService,
  UploadedMediaFile,
} from './media-ingestion/media-ingestion.service';
import { MediaIngestionEnabledGuard } from './media-ingestion/media-ingestion-enabled.guard';
import {
  getMediaIngestionObservation,
  MediaIngestionBoundaryInterceptor,
} from './media-ingestion/media-ingestion-boundary.interceptor';
import { MediaUploadRateLimitGuard } from './media-ingestion/media-upload-rate-limit.guard';
import { SafeMediaUploadExceptionFilter } from './media-ingestion/safe-media-upload-exception.filter';
import { ParsePositiveIntPipe } from './pipes/parse-positive-int.pipe';

type AuthenticatedRequest = Request & { user: CmsActor };

@Controller('admin/cms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class CmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly exerciseAuthoringService: ExerciseAuthoringService,
    private readonly exerciseImportService: ExerciseImportService,
    private readonly mediaAdminService: MediaAdminService,
    private readonly mediaIngestionService: MediaIngestionService,
  ) {}

  @Post('media/ingestions')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MediaIngestionEnabledGuard, MediaUploadRateLimitGuard)
  @UseFilters(SafeMediaUploadExceptionFilter)
  @UseInterceptors(
    MediaIngestionBoundaryInterceptor,
    FileInterceptor('file', {
      preservePath: true,
      limits: {
        fileSize: MEDIA_UPLOAD_MAX_BYTES,
        files: 1,
        fields: 0,
        // Busboy emits partsLimit when the counter reaches this value. Setting
        // two accepts exactly one file part and rejects any second part.
        parts: 2,
        headerPairs: 32,
      },
    }),
  )
  ingestMedia(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Query() query: MediaIngestionQueryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.mediaIngestionService.ingest(
      request.user,
      file,
      query.dataSourceId,
      idempotencyKey,
      {
        correlationId: correlationId(requestId),
        observation: getMediaIngestionObservation(request),
      },
    );
  }

  @Post('media/ingestions/:ingestionId/cleanup')
  @Header('Cache-Control', 'no-store')
  retryMediaIngestionCleanup(
    @Req() request: AuthenticatedRequest,
    @Param('ingestionId', ParsePositiveIntPipe) ingestionId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.mediaIngestionService.retryCleanup(request.user, ingestionId, {
      correlationId: correlationId(requestId),
    });
  }

  @Get('media')
  @Header('Cache-Control', 'no-store')
  listMedia(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminMediaQueryDto,
  ) {
    return this.mediaAdminService.listMedia(request.user, query);
  }

  @Get('media/:mediaId')
  @Header('Cache-Control', 'no-store')
  getMedia(
    @Req() request: AuthenticatedRequest,
    @Param('mediaId', ParsePositiveIntPipe) mediaId: number,
  ) {
    return this.mediaAdminService.getMedia(request.user, mediaId);
  }

  @Post('media/:mediaId/quarantine')
  @Header('Cache-Control', 'no-store')
  quarantineMedia(
    @Req() request: AuthenticatedRequest,
    @Param('mediaId', ParsePositiveIntPipe) mediaId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.mediaAdminService.quarantineMedia(request.user, mediaId, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('media/:mediaId/archive')
  @Header('Cache-Control', 'no-store')
  archiveMedia(
    @Req() request: AuthenticatedRequest,
    @Param('mediaId', ParsePositiveIntPipe) mediaId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.mediaAdminService.archiveMedia(request.user, mediaId, {
      correlationId: correlationId(requestId),
    });
  }

  @Get('exercises')
  listExercises(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminExercisesQueryDto,
  ) {
    return this.exerciseAuthoringService.listExercises(request.user, query);
  }

  @Get('exercises/:exerciseId')
  getExercise(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId', ParsePositiveIntPipe) exerciseId: number,
  ) {
    return this.exerciseAuthoringService.getExercise(request.user, exerciseId);
  }

  @Post('exercises')
  createExercise(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateExerciseDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.exerciseAuthoringService.createExercise(request.user, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('exercises/:exerciseId/revisions')
  createExerciseRevision(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId', ParsePositiveIntPipe) exerciseId: number,
    @Body() dto: CreateExerciseRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.exerciseAuthoringService.createExerciseRevision(
      request.user,
      exerciseId,
      dto,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('exercises/:exerciseId/revisions/:revisionId/reviews')
  reviewExerciseRevision(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId', ParsePositiveIntPipe) exerciseId: number,
    @Param('revisionId', ParsePositiveIntPipe) revisionId: number,
    @Body() dto: ReviewRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.exerciseAuthoringService.reviewExerciseRevision(
      request.user,
      exerciseId,
      revisionId,
      dto,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('exercises/:exerciseId/revisions/:revisionId/publish')
  publishExerciseRevision(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId', ParsePositiveIntPipe) exerciseId: number,
    @Param('revisionId', ParsePositiveIntPipe) revisionId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.exerciseAuthoringService.publishExerciseRevision(
      request.user,
      exerciseId,
      revisionId,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('exercises/:exerciseId/archive')
  archiveExercise(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId', ParsePositiveIntPipe) exerciseId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.exerciseAuthoringService.archiveExercise(
      request.user,
      exerciseId,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('exercise-imports/preview')
  previewExerciseImport(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PreviewExerciseImportDto,
  ) {
    return this.exerciseImportService.preview(request.user, dto);
  }

  @Post('exercise-imports')
  commitExerciseImport(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CommitExerciseImportDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.exerciseImportService.commit(
      request.user,
      dto,
      idempotencyKey,
      { correlationId: correlationId(requestId) },
    );
  }

  @Get('lessons')
  listLessons(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminLessonsQueryDto,
  ) {
    return this.cmsService.listLessons(request.user, query);
  }

  @Get('lessons/:lessonId')
  getLesson(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveIntPipe) lessonId: number,
  ) {
    return this.cmsService.getLesson(request.user, lessonId);
  }

  @Post('lessons')
  createLesson(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateLessonDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.createLesson(request.user, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('lessons/:lessonId/revisions')
  createLessonRevision(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveIntPipe) lessonId: number,
    @Body() dto: CreateLessonRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.createLessonRevision(request.user, lessonId, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('lessons/:lessonId/revisions/:revisionId/reviews')
  reviewLessonRevision(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveIntPipe) lessonId: number,
    @Param('revisionId', ParsePositiveIntPipe) revisionId: number,
    @Body() dto: ReviewRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.reviewLessonRevision(
      request.user,
      lessonId,
      revisionId,
      dto,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('lessons/:lessonId/revisions/:revisionId/publish')
  publishLessonRevision(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveIntPipe) lessonId: number,
    @Param('revisionId', ParsePositiveIntPipe) revisionId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.publishLessonRevision(
      request.user,
      lessonId,
      revisionId,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('lessons/:lessonId/archive')
  archiveLesson(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveIntPipe) lessonId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.archiveLesson(request.user, lessonId, {
      correlationId: correlationId(requestId),
    });
  }

  @Get('topics/:topicId')
  getTopic(
    @Req() request: AuthenticatedRequest,
    @Param('topicId', ParsePositiveIntPipe) topicId: number,
  ) {
    return this.cmsService.getTopic(request.user, topicId);
  }

  @Post('topics')
  createTopic(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateTopicDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.createTopic(request.user, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('topics/:topicId/revisions')
  createTopicRevision(
    @Req() request: AuthenticatedRequest,
    @Param('topicId', ParsePositiveIntPipe) topicId: number,
    @Body() dto: CreateTopicRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.createTopicRevision(request.user, topicId, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('topics/:topicId/revisions/:revisionId/reviews')
  reviewTopicRevision(
    @Req() request: AuthenticatedRequest,
    @Param('topicId', ParsePositiveIntPipe) topicId: number,
    @Param('revisionId', ParsePositiveIntPipe) revisionId: number,
    @Body() dto: ReviewRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.reviewTopicRevision(
      request.user,
      topicId,
      revisionId,
      dto,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('topics/:topicId/revisions/:revisionId/publish')
  publishTopicRevision(
    @Req() request: AuthenticatedRequest,
    @Param('topicId', ParsePositiveIntPipe) topicId: number,
    @Param('revisionId', ParsePositiveIntPipe) revisionId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.publishTopicRevision(
      request.user,
      topicId,
      revisionId,
      { correlationId: correlationId(requestId) },
    );
  }

  @Post('topics/:topicId/archive')
  archiveTopic(
    @Req() request: AuthenticatedRequest,
    @Param('topicId', ParsePositiveIntPipe) topicId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.archiveTopic(request.user, topicId, {
      correlationId: correlationId(requestId),
    });
  }
}

// RequestIdMiddleware has already replaced the header with the id echoed in
// X-Request-ID, so audit rows correlate with the response the client saw.
function correlationId(requestId: string | undefined): string {
  return isAcceptedRequestId(requestId) ? requestId : randomUUID();
}
