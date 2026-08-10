import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { OnboardingService } from './onboarding.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('learning-plans')
@UseGuards(JwtAuthGuard)
export class LearningPlansController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('current')
  getCurrentLearningPlan(@Req() request: AuthenticatedRequest) {
    return this.onboardingService.getCurrentLearningPlan(request.user.id);
  }

  @Post()
  generateLearningPlan(@Req() request: AuthenticatedRequest) {
    return this.onboardingService.generateLearningPlan(request.user.id);
  }
}
