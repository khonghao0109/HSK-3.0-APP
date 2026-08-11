import { ConflictException } from '@nestjs/common';

import { sha256CanonicalJson } from '../../common/utils/canonical-json';

import { decidePublishAction } from './cms-workflow';
import {
  ExerciseSnapshot,
  assertExerciseRevisionHash,
  isExerciseArchived,
  shouldMaterializeExerciseRevision,
} from './exercise-authoring.service';

describe('LessonExercise revision and version policy', () => {
  const snapshot: ExerciseSnapshot = {
    type: 'fill_blank',
    prompt: 'Complete the greeting.',
    content: {},
    answer: { acceptedTexts: ['你好'] },
    explanation: null,
    mediaId: null,
    orderIndex: 1,
  };

  it('accepts only the canonical hash of the immutable revision snapshot', () => {
    const hash = sha256CanonicalJson(snapshot);
    expect(assertExerciseRevisionHash(snapshot, hash)).toBe(hash);
  });

  it.each([null, '', 'tampered-hash'])(
    'rejects a missing or changed revision hash without exposing the answer',
    (hash) => {
      expect(() => assertExerciseRevisionHash(snapshot, hash)).toThrow(
        ConflictException,
      );
      try {
        assertExerciseRevisionHash(snapshot, hash);
      } catch (error) {
        expect(String(error)).not.toContain('你好');
      }
    },
  );

  it('materializes a new revision only while the exercise is draft', () => {
    expect(shouldMaterializeExerciseRevision('draft')).toBe(true);
    expect(shouldMaterializeExerciseRevision('published')).toBe(false);
    expect(shouldMaterializeExerciseRevision('archived')).toBe(false);
  });

  it('applies a newer approved revision even when it restores an older live hash', () => {
    const contentHash = sha256CanonicalJson(snapshot);

    expect(
      decidePublishAction({
        requestedRevisionId: 3,
        latestRevisionId: 3,
        latestDecision: 'approved',
        liveContentHash: contentHash,
        requestedContentHash: contentHash,
        liveContentMatchesRevision: false,
      }),
    ).toBe('apply');
  });

  it('treats either archived marker as immutable fail-closed evidence', () => {
    expect(isExerciseArchived({ status: 'archived', deletedAt: null })).toBe(
      true,
    );
    expect(isExerciseArchived({ status: 'draft', deletedAt: new Date() })).toBe(
      true,
    );
    expect(isExerciseArchived({ status: 'draft', deletedAt: null })).toBe(
      false,
    );
  });
});
