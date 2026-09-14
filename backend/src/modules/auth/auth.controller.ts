import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { ipTracker } from '../../common/guards/custom-throttler.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

type AuthenticatedUser = {
  id: number;
  email: string;
  role: string;
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
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({
    default: { limit: loginIpLimit, ttl: 60_000, getTracker: ipTracker },
  })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Req() req: AuthenticatedRequest) {
    return {
      user: req.user,
    };
  }
}
