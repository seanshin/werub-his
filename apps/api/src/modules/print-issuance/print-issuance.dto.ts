import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { SERVER_BUILT_DOCUMENT_TYPES, type ServerBuiltDocumentType } from '@hospital-run/shared';

/**
 * 서버 발급 인쇄본 — 🔴 본문은 종류와 식별 조건뿐이다. 스냅샷은 서버가 지금 원장에서 만든다
 * (본문에 snapshot·lines 가 와도 whitelist 가 버린다).
 */
export class PrintIssueDto {
  @ApiProperty({ enum: SERVER_BUILT_DOCUMENT_TYPES })
  @IsIn([...SERVER_BUILT_DOCUMENT_TYPES])
  kind!: ServerBuiltDocumentType;

  @ApiPropertyOptional({ description: 'DECISION_RECORD — 결정 키' })
  @IsOptional() @IsString() @MaxLength(200)
  key?: string;

  @ApiPropertyOptional({ description: 'DUTY_ROSTER — YYYY-MM' })
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;

  @ApiPropertyOptional({ description: 'DUTY_ROSTER — 부서(없거나 전체 = 전 부서)' })
  @IsOptional() @IsString() @MaxLength(50)
  department?: string;

  @ApiPropertyOptional({ description: 'QI_REPORT — 보고서 id' })
  @IsOptional() @IsUUID()
  reportId?: string;
}
