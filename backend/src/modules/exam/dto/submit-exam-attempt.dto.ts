import { IsUUID } from 'class-validator';

/**
 * TL-150: the only body field of `POST /exam/attempts/:attemptId/submit`. The
 * global `ValidationPipe` forbids unknown keys, so a client cannot smuggle
 * `score`/`answers`/`result` into the submit contract (R11).
 */
export class SubmitExamAttemptDto {
  @IsUUID()
  idempotencyKey!: string;
}
