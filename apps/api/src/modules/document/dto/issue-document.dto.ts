import { IsString, IsOptional, IsObject } from 'class-validator';

export class IssueDocumentDto {
  @IsString() documentType!: string;     // LAB_REPORT | ENCOUNTER_RECORD | PRESCRIPTION | ...
  @IsString() sourceId!: string;
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() formVersion?: string;
  @IsObject() snapshot!: Record<string, unknown>; // 발급 시점 데이터(동결)
}
