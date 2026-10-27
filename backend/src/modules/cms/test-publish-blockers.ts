import { ContentStatus, MediaType, Skill } from '@prisma/client';

import { publishMediaBlocker, type CmsMediaRecord } from './media-usability';

/**
 * TL-98/TL-111: the publish gate of a Test. Pure so the learner exam start path
 * (M4.2a) re-runs exactly the same checks without a second copy, and so the
 * publish behaviour stays byte-for-byte the same after the extraction.
 */
export type TestPublishBlocker = {
  code: string;
  field: string;
};

export type TestPublishBlockerQuestion = {
  id: number;
  status: ContentStatus;
  deletedAt: Date | null;
  levelId: number;
  skill: Skill;
};

/** The structural slice of `TestDetailRecord` the gate reads. */
export type TestPublishBlockerTree = {
  levelId: number;
  passScore: number | null;
  sections: Array<{
    skill: Skill;
    groups: Array<{
      audioId: number | null;
      imageId: number | null;
      placements: Array<{ testQuestion: { questionId: number } }>;
    }>;
  }>;
};

export type TestPublishBlockerInput = {
  test: TestPublishBlockerTree;
  questions: TestPublishBlockerQuestion[];
  media: CmsMediaRecord[];
  levelExists: boolean;
};

export function collectTestPublishBlockers(
  input: TestPublishBlockerInput,
): TestPublishBlocker[] {
  const { test, questions, media, levelExists } = input;
  const blockers: TestPublishBlocker[] = [];
  const sectionCount = test.sections.length;
  const maxScore = 100 * sectionCount;

  if (!levelExists) {
    blockers.push({ code: 'level_not_found', field: 'levelId' });
  }
  if (sectionCount === 0) {
    blockers.push({ code: 'sections_required', field: 'sections' });
  }

  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const mediaById = new Map(media.map((item) => [item.id, item]));

  for (let i = 0; i < test.sections.length; i += 1) {
    const section = test.sections[i];
    if (!section) continue;
    const sectionField = `sections[${String(i)}]`;
    if (section.groups.length === 0) {
      blockers.push({ code: 'section_empty', field: sectionField });
      continue;
    }
    for (let j = 0; j < section.groups.length; j += 1) {
      const group = section.groups[j];
      if (!group) continue;
      const groupField = `${sectionField}.groups[${String(j)}]`;
      if (group.placements.length === 0) {
        blockers.push({ code: 'group_empty', field: groupField });
      }
      for (let k = 0; k < group.placements.length; k += 1) {
        const placement = group.placements[k];
        if (!placement) continue;
        const questionId = placement.testQuestion.questionId;
        const question = questionsById.get(questionId);
        const questionField = `${groupField}.questionIds[${String(k)}]`;
        if (!question) {
          // A question that no longer exists cannot be evaluated further.
          blockers.push({
            code: 'question_not_published',
            field: questionField,
          });
          continue;
        }
        // H2: one question contributes every code that is true for it, so the
        // author fixes all problems in one round.
        if (
          question.deletedAt !== null ||
          question.status !== ContentStatus.published
        ) {
          blockers.push({
            code: 'question_not_published',
            field: questionField,
          });
        }
        if (question.levelId !== test.levelId) {
          blockers.push({
            code: 'question_level_mismatch',
            field: questionField,
          });
        }
        if (question.skill !== section.skill) {
          blockers.push({
            code: 'question_skill_mismatch',
            field: questionField,
          });
        }
      }
      if (group.audioId !== null) {
        const audio = mediaById.get(group.audioId) ?? null;
        if (publishMediaBlocker(audio, MediaType.audio) !== null) {
          blockers.push({
            code: 'audio_not_ready',
            field: `${groupField}.audioId`,
          });
        }
      }
      if (group.imageId !== null) {
        const image = mediaById.get(group.imageId) ?? null;
        if (publishMediaBlocker(image, MediaType.image) !== null) {
          blockers.push({
            code: 'image_not_ready',
            field: `${groupField}.imageId`,
          });
        }
      }
    }
  }

  if (test.passScore === null) {
    blockers.push({ code: 'pass_score_required', field: 'passScore' });
  } else if (test.passScore < 0 || test.passScore > maxScore) {
    blockers.push({
      code: 'pass_score_out_of_range',
      field: 'passScore',
    });
  }
  return blockers;
}
