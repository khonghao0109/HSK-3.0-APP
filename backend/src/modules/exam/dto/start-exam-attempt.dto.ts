import { IsUUID } from 'class-validator';

/**
 * TL-111: the only body field of `POST /exam/tests/:testId/attempts`. The key
 * is a UUID so a client can retry the same start without creating a second
 * attempt, and a reused key for another test is rejected with 409.
 */
export class StartExamAttemptDto {
  @IsUUID()
  idempotencyKey!: string;
}
