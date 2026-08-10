import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CreateGoalDto } from './dto/create-goal.dto';
import { OnboardingService } from './onboarding.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('status')
  getStatus(@Req() request: AuthenticatedRequest) {
    return this.onboardingService.getStatus(request.user.id);
  }

  @Get('goals/current')
  getCurrentGoal(@Req() request: AuthenticatedRequest) {
    return this.onboardingService.getCurrentGoal(request.user.id);
  }

  @Post('goals')
  setGoal(@Req() request: AuthenticatedRequest, @Body() dto: CreateGoalDto) {
    return this.onboardingService.setGoal(request.user.id, dto);
  }
}
