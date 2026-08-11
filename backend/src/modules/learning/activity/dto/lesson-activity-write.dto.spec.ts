import { ValidationPipe } from '@nestjs/common';

import {
  EmptyLessonActivityWriteDto,
  SubmitLessonExerciseAttemptDto,
} from './lesson-activity-write.dto';

describe('Lesson Activity write DTO security', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it.each([
    'userId',
    'attemptNumber',
    'score',
    'isCorrect',
    'exerciseVersion',
    'contentSnapshot',
    'feedbackVersion',
    'submittedAt',
    'lessonId',
  ])('rejects server-controlled field %s', async (field) => {
    await expect(
      pipe.transform(
        { answer: { optionId: 'a' }, [field]: 1 },
        {
          type: 'body',
          metatype: SubmitLessonExerciseAttemptDto,
          data: '',
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects fields on empty start/complete bodies', async () => {
    await expect(
      pipe.transform(
        { progress: 100 },
        { type: 'body', metatype: EmptyLessonActivityWriteDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
