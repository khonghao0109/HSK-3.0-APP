import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
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
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

type AuthenticatedUser = {
  id: number;
  email: string;
  role: Role;
};

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

export const LOGIN_IP_LIMIT_PER_MINUTE = 10;

/**
 * Resolved per request. Backend and browser E2E log in many times from one
 * loopback address, as the global limit in AppModule already allows.
 */
export function loginIpLimit(): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : LOGIN_IP_LIMIT_PER_MINUTE;
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

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(OPENAPI_BEARER_AUTH)
  @Get('me')
  @ApiEnvelope(AuthMeResponseDto)
  getProfile(@Req() req: AuthenticatedRequest): AuthMeResponseDto {
    return {
      user: req.user,
    };
  }
}
