import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiResponse } from './interfaces/learning-response.interface';

@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

  getTestMessage(): ApiResponse<string> {
    return {
      success: true,
      data: 'Learning module working',
    };
  }
}
