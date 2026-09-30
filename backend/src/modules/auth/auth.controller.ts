import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Role } from '@prisma/client';
import { Request } from 'express';

import { ipTracker } from '../../common/guards/custom-throttler.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';

import { AuthService } from './auth.service';
import {
  AuthMeResponseDto,
  AuthTokenResponseDto,
} from './dto/auth-response.dto';
import { ConfirmEmailVerificationDto } from './dto/confirm-email-verification.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

type AuthenticatedUser = {
  id: number;
  email: string;
  role: Role;
  sid: number;
};

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

export const LOGIN_IP_LIMIT_PER_MINUTE = 10;
export const REFRESH_IP_LIMIT_PER_MINUTE = 30;

/**
 * Resolved per request. Backend and browser E2E log in many times from one
 * loopback address, as the global limit in AppModule already allows.
 */
export function loginIpLimit(): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : LOGIN_IP_LIMIT_PER_MINUTE;
}

export function refreshIpLimit(): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : REFRESH_IP_LIMIT_PER_MINUTE;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 100, ttl: 60_000, getTracker: ipTracker } })
  @ApiEnvelope(AuthTokenResponseDto)
  register(@Body() registerDto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({
    default: { limit: loginIpLimit, ttl: 60_000, getTracker: ipTracker },
  })
  @ApiEnvelope(AuthTokenResponseDto)
  login(@Body() loginDto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: refreshIpLimit, ttl: 60_000, getTracker: ipTracker },
  })
  @ApiEnvelope(AuthTokenResponseDto)
  refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<AuthTokenResponseDto> {
    return this.authService.refresh(refreshTokenDto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Session successfully revoked.',
  })
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.authService.logout(req.user.sid);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @Get('me')
  @ApiEnvelope(AuthMeResponseDto)
  getProfile(@Req() req: AuthenticatedRequest): AuthMeResponseDto {
    return {
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @Post('email-verification/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 3, ttl: 15 * 60 * 1000 } })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Email verification request accepted.',
  })
  async requestEmailVerification(
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.authService.requestEmailVerification(req.user.id);
  }

  @Post('email-verification/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60 * 1000, getTracker: ipTracker } })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Email verified successfully.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid or expired verification token.',
  })
  async confirmEmailVerification(
    @Body() confirmDto: ConfirmEmailVerificationDto,
  ): Promise<void> {
    await this.authService.confirmEmailVerification(confirmDto.token);
  }
}
