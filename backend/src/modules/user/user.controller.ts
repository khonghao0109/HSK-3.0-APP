import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { RolesGuard } from '../../common/guards/roles.guard';

import { AccountDeletionResponseDto } from './dto/account-deletion-response.dto';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
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
  constructor(private readonly userService: UserService) {}

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
