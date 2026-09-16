import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  ApiErrorEnvelope,
  ApiResponseMeta,
  PaginationMeta,
} from '../interfaces/api-response.interface';

// OpenAPI models of the envelope written by TransformInterceptor and
// GlobalExceptionFilter (docs/api/api.md §1). Only the document uses them.

export class PaginationMetaDto implements PaginationMeta {
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  limit!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalPages!: number;
}

export class ApiResponseMetaDto implements Omit<ApiResponseMeta, 'pagination'> {
  /** Same value as the `X-Request-ID` response header. */
  requestId!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

export class ApiPageResponseMetaDto
  extends ApiResponseMetaDto
  implements ApiResponseMeta
{
  pagination!: PaginationMetaDto;
}

export class ApiErrorDto implements Readonly<ApiErrorEnvelope['error']> {
  /** Stable machine-readable code, for example `UNAUTHORIZED`. */
  code!: string;

  message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  details?: Record<string, unknown>;
}

export class ApiErrorEnvelopeDto implements ApiErrorEnvelope {
  @ApiProperty({ type: 'boolean', enum: [false] })
  success!: false;

  error!: ApiErrorDto;

  meta!: ApiResponseMetaDto;
}
