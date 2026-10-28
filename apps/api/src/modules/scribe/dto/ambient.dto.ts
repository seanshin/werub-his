import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const AMBIENT_SPEAKERS = ['DOCTOR', 'PATIENT', 'UNKNOWN'] as const;
export type AmbientSpeaker = (typeof AMBIENT_SPEAKERS)[number];

export class StartAmbientSessionDto {
  @IsUUID()
  encounterId!: string;
}

export class AddUtteranceDto {
  @IsInt()
  @Min(0)
  @Max(100000)
  seq!: number;

  @IsString()
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsIn(AMBIENT_SPEAKERS as unknown as string[])
  speaker?: AmbientSpeaker;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(600)
  droppedSec?: number;
}

export const SOAP_FIELDS = ['subjective', 'objective', 'assessment', 'plan'] as const;

export class ApplySuggestionDto {
  @IsIn(SOAP_FIELDS as unknown as string[])
  field!: (typeof SOAP_FIELDS)[number];

  @IsString()
  @MaxLength(8000)
  text!: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  sourceSeqs?: number[];

  @IsOptional()
  @IsIn(['RULE', 'AI'])
  engine?: 'RULE' | 'AI';
}

export class PatchUtteranceDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsIn(AMBIENT_SPEAKERS as unknown as string[])
  speaker?: AmbientSpeaker;

  @IsOptional()
  @IsBoolean()
  deleted?: boolean;
}
