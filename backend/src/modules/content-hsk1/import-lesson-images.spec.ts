import { planLessonImages } from './import-lesson-images';

describe('planLessonImages (Q350)', () => {
  const words = [
    { wordId: 11, hanzi: '老师' },
    { wordId: 12, hanzi: '学生' },
  ];

  it('maps the cover and each word image to exactly one lesson word', () => {
    expect(
      planLessonImages(
        [
          { key: 'l01-cover', word: null, altVi: 'bìa' },
          { key: 'l01-laoshi', word: '老师', altVi: 'cô giáo' },
        ],
        words,
      ),
    ).toEqual({
      coverKey: 'l01-cover',
      wordImages: [{ key: 'l01-laoshi', wordId: 11 }],
    });
  });

  it('refuses a word that is not in the lesson and a second cover', () => {
    expect(() =>
      planLessonImages([{ key: 'x', word: '朋友', altVi: 'a' }], words),
    ).toThrow('朋友');
    expect(() =>
      planLessonImages(
        [
          { key: 'a', word: null, altVi: 'a' },
          { key: 'b', word: null, altVi: 'b' },
        ],
        words,
      ),
    ).toThrow('Có hơn một ảnh bìa');
  });
});
