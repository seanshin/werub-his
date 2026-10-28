import {
  IsString, IsBoolean, IsOptional, IsUUID, IsArray, ArrayMaxSize,
  ValidateNested, MaxLength, IsInt, Min, Max, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 보조 집도진 1인 — `SurgeryOpNote.assistants`(Json `[{userId, name}]`).
 *
 * 🔴 예약 단계의 `Surgery.assistantId` 와 다른 사실이다: 예약은 **예정된 보조의 1명**,
 *    수술기록은 **실제로 집도에 참여한 사람 전원**이다. uuid 칸에 이름 문자열을 밀어 넣으면
 *    그 순간 원장이 거짓이 되므로 `userId` 는 IsUUID 로 잠근다(자유 텍스트는 400 으로 거절).
 *    `name` 은 기록 시점 표시명 스냅샷일 뿐 정본이 아니다 — 조회는 userId 로 한다.
 */
export class OpNoteAssistantDto {
  @ApiProperty({ description: '보조 집도의 계정 ID — 이름 문자열 불가' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: '기록 시점 표시명(스냅샷)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

/** Clavien-Dindo 등급 — 컬럼 `complication_grade` VarChar(10). 숫자(3.1)가 아니라 등급 문자열이다. */
export const CLAVIEN_DINDO_GRADES = ['NONE', 'I', 'II', 'IIIa', 'IIIb', 'IVa', 'IVb', 'V'] as const;

export class CreateOpNoteDto {
  @ApiProperty({ description: '수술 ID' })
  @IsUUID()
  surgeryId: string;

  @ApiPropertyOptional() @IsOptional() @IsString() preOpDiagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postOpDiagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() procedureCode?: string;
  @ApiPropertyOptional({ type: [OpNoteAssistantDto], description: '실제 참여 보조 집도진' })
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => OpNoteAssistantDto)
  assistants?: OpNoteAssistantDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() anesthesiaType?: string;
  // 🔴 시각은 원장에 그대로 박힌다 — 파싱 불가한 문자열이 들어오면 Invalid Date 로 저장되거나
  //    500 이 난다. 문자열 형태를 여기서 잠근다('YYYY-MM-DDTHH:mm' 또는 ISO 8601).
  @ApiPropertyOptional({ description: '절개 시각 — YYYY-MM-DDTHH:mm 또는 ISO 8601' })
  @IsOptional() @IsString() @MaxLength(40) incisionTime?: string;
  @ApiPropertyOptional({ description: '봉합 시각 — YYYY-MM-DDTHH:mm 또는 ISO 8601' })
  @IsOptional() @IsString() @MaxLength(40) closureTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() findings?: string;
  @ApiPropertyOptional() @IsOptional() specimens?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) estimatedBloodLoss?: number;
  @ApiPropertyOptional() @IsOptional() fluidBalance?: unknown;
  @ApiPropertyOptional() @IsOptional() implants?: unknown;
  @ApiPropertyOptional() @IsOptional() drains?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() narrative?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postOpOrders?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(6) asaClass?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(4) mallampatiClass?: number;
  @ApiPropertyOptional() @IsOptional() npoStatus?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() prophylacticAbx?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vteProphylaxis?: boolean;
  /** @deprecated 정본은 SurgicalChecklist(`/api/v1/surgery/:id/checklist`) — 이 컬럼은 읽는 곳이 없다(쓰기 경로만 남겨둔 사본). */
  @ApiPropertyOptional({ deprecated: true, description: '[deprecated] 정본은 SurgicalChecklist' }) @IsOptional() whoChecklist?: unknown;
  @ApiPropertyOptional({ description: 'Clavien-Dindo 등급', enum: CLAVIEN_DINDO_GRADES })
  @IsOptional() @IsIn(CLAVIEN_DINDO_GRADES as unknown as string[]) complicationGrade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complications?: string;
}

export class UpdateOpNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() preOpDiagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postOpDiagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() procedureCode?: string;
  @ApiPropertyOptional({ type: [OpNoteAssistantDto], description: '실제 참여 보조 집도진' })
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => OpNoteAssistantDto)
  assistants?: OpNoteAssistantDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() anesthesiaType?: string;
  // 🔴 시각은 원장에 그대로 박힌다 — 파싱 불가한 문자열이 들어오면 Invalid Date 로 저장되거나
  //    500 이 난다. 문자열 형태를 여기서 잠근다('YYYY-MM-DDTHH:mm' 또는 ISO 8601).
  @ApiPropertyOptional({ description: '절개 시각 — YYYY-MM-DDTHH:mm 또는 ISO 8601' })
  @IsOptional() @IsString() @MaxLength(40) incisionTime?: string;
  @ApiPropertyOptional({ description: '봉합 시각 — YYYY-MM-DDTHH:mm 또는 ISO 8601' })
  @IsOptional() @IsString() @MaxLength(40) closureTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() findings?: string;
  @ApiPropertyOptional() @IsOptional() specimens?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) estimatedBloodLoss?: number;
  @ApiPropertyOptional() @IsOptional() fluidBalance?: unknown;
  @ApiPropertyOptional() @IsOptional() implants?: unknown;
  @ApiPropertyOptional() @IsOptional() drains?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() narrative?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postOpOrders?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(6) asaClass?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(4) mallampatiClass?: number;
  @ApiPropertyOptional() @IsOptional() npoStatus?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() prophylacticAbx?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vteProphylaxis?: boolean;
  /** @deprecated 정본은 SurgicalChecklist(`/api/v1/surgery/:id/checklist`) — 이 컬럼은 읽는 곳이 없다(쓰기 경로만 남겨둔 사본). */
  @ApiPropertyOptional({ deprecated: true, description: '[deprecated] 정본은 SurgicalChecklist' }) @IsOptional() whoChecklist?: unknown;
  @ApiPropertyOptional({ description: 'Clavien-Dindo 등급', enum: CLAVIEN_DINDO_GRADES })
  @IsOptional() @IsIn(CLAVIEN_DINDO_GRADES as unknown as string[]) complicationGrade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complications?: string;
}
