import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../common/pipes/parse-positive-safe-integer.pipe';
import { RolesGuard } from '../../common/guards/roles.guard';

import { AccountDeletionResponseDto } from './dto/account-deletion-response.dto';
import { CreateDataExportResponseDto } from './dto/create-data-export-response.dto';
import { DataExportItemDto } from './dto/data-export-response.dto';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { DataExportService } from './data-export.service';
import { UserService } from './user.service';

type AuthenticatedUser = {
  id: number;
  email: string;
  role: string;
};

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly dataExportService: DataExportService,
  ) {}

  @Get('me/profile')
  @ApiEnvelope(UserProfileResponseDto)
  getMeProfile(
    @Req() req: AuthenticatedRequest,
  ): Promise<UserProfileResponseDto> {
    return this.userService.getUserProfile(req.user.id);
  }

  @Patch('me/profile')
  @ApiEnvelope(UserProfileResponseDto)
  updateMeProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponseDto> {
    if (
      dto.displayName === undefined &&
      dto.locale === undefined &&
      dto.timezone === undefined
    ) {
      throw new BadRequestException('Request body must not be empty.');
    }
    return this.userService.updateUserProfile(req.user.id, dto);
  }

  @Post('me/deletion-request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @ApiEnvelope(AccountDeletionResponseDto)
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Account deletion request accepted with 7-day grace period.',
    type: AccountDeletionResponseDto,
  })
  requestAccountDeletion(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RequestAccountDeletionDto,
  ): Promise<AccountDeletionResponseDto> {
    return this.userService.requestAccountDeletion(req.user.id, dto);
  }

  @Post('me/data-exports')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiEnvelope(CreateDataExportResponseDto)
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Data export requested successfully.',
    type: CreateDataExportResponseDto,
  })
  requestDataExport(
    @Req() req: AuthenticatedRequest,
  ): Promise<CreateDataExportResponseDto> {
    return this.dataExportService.requestDataExport(req.user.id);
  }

  @Get('me/data-exports')
  @ApiEnvelope([DataExportItemDto])
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of data exports for current user.',
    type: [DataExportItemDto],
  })
  listDataExports(
    @Req() req: AuthenticatedRequest,
  ): Promise<DataExportItemDto[]> {
    return this.dataExportService.listDataExports(req.user.id);
  }

  @Get('me/data-exports/:id/download')
  @RawResponse()
  @ApiOkResponse({
    description: 'Data export JSON file.',
    content: {
      'application/json': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async downloadDataExport(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParsePositiveSafeIntegerPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.dataExportService.getDownloadableExport(
      req.user.id,
      id,
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hsk-data-export-${id}.json"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(file.body);
  }

  @Get('me')
  getMe(@Req() req: AuthenticatedRequest) {
    return this.userService.getProfile(req.user.id);
  }

  @Get()
  @Roles('admin')
  getAllUsers(@Query() query: PaginationQueryDto) {
    return this.userService.getAllUsers(query);
  }
}
