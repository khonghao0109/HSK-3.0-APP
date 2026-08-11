import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateLessonRevisionDto } from './create-lesson-revision.dto';
import { CreateTopicRevisionDto } from './create-topic-revision.dto';

describe('CMS revision DTOs', () => {
  it.each([
    ['createdById', 1],
    ['updatedById', 1],
    ['publishedById', 1],
    ['publishedAt', '2026-08-10T00:00:00.000Z'],
    ['status', 'published'],
    ['revision', 99],
    ['authorId', 1],
    ['actorId', 1],
  ])('rejects server-controlled Lesson field %s', async (field, value) => {
    const dto = plainToInstance(CreateLessonRevisionDto, {
      levelId: 1,
      title: 'Lesson title',
      description: null,
      orderIndex: 1,
      slug: 'lesson-title',
      [field]: value,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('rejects oversized/invalid Topic payload and server-controlled fields', async () => {
    const dto = plainToInstance(CreateTopicRevisionDto, {
      lessonId: 1,
      title: 'Topic',
      subtitle: null,
      type: 'vocabulary',
      content: [{ type: 'text', value: 'x'.repeat(100_001) }],
      orderIndex: 1,
      isPremium: false,
      isLocked: false,
      status: 'published',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['content', 'status']),
    );
  });
});
