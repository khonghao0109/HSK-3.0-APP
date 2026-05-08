import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiResponse } from './interfaces/learning-response.interface';
import { LevelItemDto, LevelsResponseDto } from './dto/level-response.dto';

@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

  getTestMessage(): ApiResponse<string> {
    return {
      success: true,
      data: 'Learning module working',
    };
  }
  async getLevels(): Promise<LevelsResponseDto> {
    const levels = await this.prisma.level.findMany({
      orderBy: {
        orderIndex: 'asc',
      },
      select: {
        id: true,
        name: true,
        orderIndex: true,
      },
    });

    return {
      success: true,
      data: levels.map(
        (level): LevelItemDto => ({
          id: level.id,
          name: level.name,
          orderIndex: level.orderIndex,
        }),
      ),
    };
  }
}
