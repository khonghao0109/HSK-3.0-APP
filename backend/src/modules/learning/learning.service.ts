import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiResponse } from './interfaces/learning-response.interface';
import { LevelItemDto, LevelsResponseDto } from './dto/level-response.dto';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { LessonItemDto, LessonsResponseDto } from './dto/lesson-response.dto';

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

  async getLessons(query: GetLessonsQueryDto): Promise<LessonsResponseDto> {
    const lessons = await this.prisma.lesson.findMany({
      where: {
        levelId: query.levelId,
      },
      orderBy: {
        orderIndex: 'asc',
      },
      select: {
        id: true,
        title: true,
        description: true,
        orderIndex: true,
        slug: true,
      },
    });

    return {
      success: true,
      data: lessons.map(
        (lesson): LessonItemDto => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          orderIndex: lesson.orderIndex,
          slug: lesson.slug,
        }),
      ),
    };
  }
}
