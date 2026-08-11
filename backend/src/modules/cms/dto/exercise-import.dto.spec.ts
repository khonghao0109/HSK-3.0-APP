import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PreviewExerciseImportDto } from './exercise-import.dto';

describe('PreviewExerciseImportDto', () => {
  it('rejects a V1 batch above the tested all-or-nothing limit', () => {
    const dto = plainToInstance(PreviewExerciseImportDto, {
      dataSourceId: 1,
      fileName: 'exercise-import.json',
      rows: Array.from({ length: 101 }, () => ({})),
    });

    expect(validateSync(dto)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'rows',
          constraints: expect.objectContaining({
            arrayMaxSize: expect.any(String),
          }),
        }),
      ]),
    );
  });
});
