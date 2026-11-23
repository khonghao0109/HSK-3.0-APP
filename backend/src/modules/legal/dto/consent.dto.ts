import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

import { IsStrictBoolean } from '../../../common/decorators/is-strict-boolean.decorator';
import {
  DOCUMENT_CONSENT_STATUSES,
  type DocumentConsentStatus,
  LEGAL_DOCUMENT_TYPES,
  LEGAL_VERSION_PATTERN,
  type LegalDocumentTypeName,
  OPTIONAL_CONSENT_TYPES,
  type OptionalConsentTypeName,
  SHA256_HEX_PATTERN,
} from '../consent-state';

/** One legal document version the user agrees to. */
export class AcceptedDocumentDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES })
  @IsIn(LEGAL_DOCUMENT_TYPES)
  type!: LegalDocumentTypeName;

  @IsString()
  @Matches(LEGAL_VERSION_PATTERN)
  version!: string;

  /** Lowercase hex SHA-256 of the document, as `GET /legal/documents/current` returns it. */
  @IsString()
  @Matches(SHA256_HEX_PATTERN)
  sha256!: string;
}

export class AcceptDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LEGAL_DOCUMENT_TYPES.length)
  @ValidateNested({ each: true })
  @Type(() => AcceptedDocumentDto)
  documents!: AcceptedDocumentDto[];
}

export class SetOptionalConsentDto {
  @IsStrictBoolean()
  granted!: boolean;
}

export class OptionalConsentTypeParamDto {
  @ApiProperty({ enum: OPTIONAL_CONSENT_TYPES })
  @IsIn(OPTIONAL_CONSENT_TYPES)
  type!: OptionalConsentTypeName;
}

export class CurrentLegalDocumentDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES })
  type!: LegalDocumentTypeName;

  version!: string;
  sha256!: string;
  effectiveAt!: Date;
}

export class DocumentConsentStateDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES })
  type!: LegalDocumentTypeName;

  /**
   * `accepted` the current version; `pending` may postpone until `deadline`;
   * `blocked` past `effectiveAt` without consent; `not_required` no version yet.
   */
  @ApiProperty({ enum: DOCUMENT_CONSENT_STATUSES })
  status!: DocumentConsentStatus;

  @ApiProperty({ type: String, nullable: true })
  version!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sha256!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  effectiveAt!: Date | null;

  /** Set only when `status` is `pending`. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deadline!: Date | null;
}

export class OptionalConsentStateDto {
  @ApiProperty({ enum: OPTIONAL_CONSENT_TYPES })
  type!: OptionalConsentTypeName;

  granted!: boolean;
}

export class UserConsentsResponseDto {
  documents!: DocumentConsentStateDto[];
  optional!: OptionalConsentStateDto[];
}
