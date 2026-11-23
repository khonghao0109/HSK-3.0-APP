import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { LEGAL_DOCUMENT_TYPES } from '../../legal/consent-state';
import { AcceptedDocumentDto } from '../../legal/dto/consent.dto';
import { NEW_PASSWORD_MIN_LENGTH } from '../constants/password-policy';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(NEW_PASSWORD_MIN_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /**
   * M1.7b2 (Q188): legal documents ticked at sign-up. Each must be the current
   * version of its type; consent rows are written with `channel = signup`.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LEGAL_DOCUMENT_TYPES.length)
  @ValidateNested({ each: true })
  @Type(() => AcceptedDocumentDto)
  acceptedDocuments?: AcceptedDocumentDto[];
}
