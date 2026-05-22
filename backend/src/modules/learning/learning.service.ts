import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { LevelItemDto } from './dto/level-response.dto';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { GetStoriesQueryDto } from './dto/get-stories-query.dto';
import { GetTopicsQueryDto } from './dto/get-topics-query.dto';
import { LessonDetailDto, LessonItemDto } from './dto/lesson-response.dto';
import { StoryItemDto } from './dto/story-response.dto';
import { TopicContentBlock, TopicItemDto } from './dto/topic-response.dto';

@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

  getTestMessage(): ApiSuccessResponse<string> {
    return {
      success: true,
      data: 'Learning module working',
    };
  }
  async getLevels(): Promise<ApiSuccessResponse<LevelItemDto[]>> {
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

  async getLessons(
    query: GetLessonsQueryDto,
  ): Promise<ApiSuccessResponse<LessonItemDto[], PaginationMeta>> {
    const where = {
      levelId: query.levelId,
      status: 'published' as const,
      deletedAt: null,
    };
    const pagination = this.getPagination(query.page, query.limit);
    const [lessons, total] = await this.prisma.$transaction([
      this.prisma.lesson.findMany({
        where,
        orderBy: {
          orderIndex: 'asc',
        },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          title: true,
          description: true,
          orderIndex: true,
          slug: true,
        },
      }),
      this.prisma.lesson.count({ where }),
    ]);

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
      meta: this.buildPaginationMeta(query.page, query.limit, total),
    };
  }

  async getLessonDetail(
    id: number,
  ): Promise<ApiSuccessResponse<LessonDetailDto>> {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id,
        status: 'published',
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        level: {
          select: {
            id: true,
            name: true,
            orderIndex: true,
            stories: {
              where: {
                status: 'published',
                deletedAt: null,
              },
              orderBy: {
                orderIndex: 'asc',
              },
              select: {
                id: true,
                title: true,
                content: true,
                slug: true,
              },
            },
          },
        },
        topics: {
          where: {
            status: 'published',
            deletedAt: null,
          },
          orderBy: {
            orderIndex: 'asc',
          },
          select: {
            id: true,
            title: true,
            content: true,
            orderIndex: true,
          },
        },
        lessonWords: {
          orderBy: {
            orderIndex: 'asc',
          },
          select: {
            word: {
              select: {
                id: true,
                hanzi: true,
                traditional: true,
                pinyin: true,
                pinyinTone: true,
                meanings: {
                  select: {
                    meaningEn: true,
                    meaningVi: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    return {
      success: true,
      data: {
        id: lesson.id,
        title: lesson.title,
        level: {
          id: lesson.level.id,
          name: lesson.level.name,
          orderIndex: lesson.level.orderIndex,
        },
        topics: lesson.topics,
        words: lesson.lessonWords.map(({ word }) => ({
          id: word.id,
          hanzi: word.hanzi,
          traditional: word.traditional,
          pinyin: word.pinyin,
          pinyinTone: word.pinyinTone,
          meanings: word.meanings.map((meaning) => ({
            en: meaning.meaningEn,
            vi: meaning.meaningVi,
          })),
        })),
        stories: lesson.level.stories,
      },
    };
  }

  async getTopics(
    query: GetTopicsQueryDto,
  ): Promise<ApiSuccessResponse<TopicItemDto[], PaginationMeta>> {
    const where = {
      lessonId: query.lessonId,
      status: 'published' as const,
      deletedAt: null,
    };
    const pagination = this.getPagination(query.page, query.limit);
    const [topics, total] = await this.prisma.$transaction([
      this.prisma.topic.findMany({
        where,
        orderBy: {
          orderIndex: 'asc',
        },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          lessonId: true,
          title: true,
          content: true,
          orderIndex: true,
        },
      }),
      this.prisma.topic.count({ where }),
    ]);

    return {
      success: true,
      data: topics.map(
        (topic): TopicItemDto => ({
          id: topic.id,
          lessonId: topic.lessonId,
          title: topic.title,
          content: topic.content as TopicContentBlock[],
          orderIndex: topic.orderIndex,
        }),
      ),
      meta: this.buildPaginationMeta(query.page, query.limit, total),
    };
  }

  async getStories(
    query: GetStoriesQueryDto,
  ): Promise<ApiSuccessResponse<StoryItemDto[], PaginationMeta>> {
    const where = {
      levelId: query.levelId,
      status: 'published' as const,
      deletedAt: null,
    };
    const pagination = this.getPagination(query.page, query.limit);
    const [stories, total] = await this.prisma.$transaction([
      this.prisma.story.findMany({
        where,
        orderBy: {
          orderIndex: 'asc',
        },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          levelId: true,
          title: true,
          content: true,
          slug: true,
        },
      }),
      this.prisma.story.count({ where }),
    ]);

    return {
      success: true,
      data: stories.map(
        (story): StoryItemDto => ({
          id: story.id,
          levelId: story.levelId,
          title: story.title,
          content: this.stringifyStoryContent(story.content),
          slug: story.slug,
        }),
      ),
      meta: this.buildPaginationMeta(query.page, query.limit, total),
    };
  }

  private getPagination(page: number, limit: number) {
    return {
      skip: (page - 1) * limit,
      take: limit,
    };
  }

  private buildPaginationMeta(
    page: number,
    limit: number,
    total: number,
  ): PaginationMeta {
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  private stringifyStoryContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (content === null || content === undefined) {
      return '';
    }

    return JSON.stringify(content);
  }
}
