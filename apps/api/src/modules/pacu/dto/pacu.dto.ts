import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PACU_DELAY_REASONS, PACU_IO_ROUTES, RASS_MAX, RASS_MIN } from '@hospital-run/shared';

/** 점수 평가 시점 — 화면이 고르는 것은 중간·퇴실 전뿐(첫 평가는 서버가 입실로 적는다) */
const PHASE_INPUT = ['INTERVAL', 'DISCHARGE'];

// 전역 whitelist ValidationPipe — 데코레이터 없는 필드는 strip. 모든 필드 class-validator 필수.

// SBAR 인수인계(구조화) — 자유 텍스트 5항목, 상한 있음
export class HandoffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) situation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) background?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) assessment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) recommendation?: string;
  @ApiPropertyOptional({ description: '라인·배액·알레르기·기타' }) @IsOptional() @IsString() @Length(1, 1000) notes?: string;
}

export class AdmitPacuDto {
  // 환자는 서버가 수술에서 정한다 — 보내면 대조만 한다(다르면 400) · 담당 간호사는 입실 처리한 사용자(보낸 값은 쓰지 않는다)
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiProperty() @IsUUID() surgeryId!: string;
  @ApiPropertyOptional({ description: '무시됨 — 입실 처리한 사용자가 담당 간호사' }) @IsOptional() @IsUUID() nurseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) oxygenTherapy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) notes?: string;
  @ApiPropertyOptional({ type: HandoffDto, description: '수술실→PACU 인수인계(SBAR)' })
  // 🔴 (2026-09-30) @IsObject 만으로는 안쪽 필드 길이 검사가 돌지 않았다 — 중첩 검증
  @IsOptional() @IsObject() @ValidateNested() @Type(() => HandoffDto) arrivalHandoff?: HandoffDto;
}

export class UpdatePonvDto {
  @ApiProperty({ description: '0 없음·1 오심·2 구역질·3 구토' }) @IsInt() @Min(0) @Max(3) score!: number;
  @ApiPropertyOptional({ enum: PHASE_INPUT }) @IsOptional() @IsIn(PHASE_INPUT) phase?: string;
  @ApiPropertyOptional({ description: 'PONV 중재(약물·조치)' }) @IsOptional() @IsString() @Length(1, 200) management?: string;
}

export class UpdatePadssDto {
  @ApiProperty({ description: '귀가 척도 총점 0~10' }) @IsInt() @Min(0) @Max(10) score!: number;
  @ApiPropertyOptional({ enum: PHASE_INPUT }) @IsOptional() @IsIn(PHASE_INPUT) phase?: string;
  @ApiProperty({ description: '5항목 {vitalSigns,ambulation,nausea,pain,bleeding} 각 0~2 — 필수(서비스가 키를 대조)' })
  @IsObject() detail!: Record<string, number>;
}

export class RecordVitalsDto {
  @ApiPropertyOptional({ description: '혈압 "수축기/이완기"' }) @IsOptional() @IsString() @Length(1, 20) bp?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(300) hr?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(80) rr?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) spo2?: number;
  // 🔴 (2026-09-30) 검증이 없어 문자열 체온이 저장되면 저체온 판정이 빠지고 "미측정"으로 보였다
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(25) @Max(45) temp?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) consciousness?: string;
  /** 2026-10-07 진정 척도 — 종전 의식은 자유 글뿐이었다 */
  @ApiPropertyOptional({ description: 'RASS −5~+4' }) @IsOptional() @IsInt() @Min(RASS_MIN) @Max(RASS_MAX) rass?: number;
}

export class UpdateAldreteDto {
  @ApiProperty({ description: '총점 0~12' }) @IsInt() @Min(0) @Max(12) score!: number;
  @ApiPropertyOptional({ enum: PHASE_INPUT }) @IsOptional() @IsIn(PHASE_INPUT) phase?: string;
  @ApiProperty({ description: '6항목 세부점수 {activity,respiration,circulation,consciousness,spo2,pain} 각 0~2 — 필수(서비스가 키를 대조)' })
  @IsObject() detail!: Record<string, number>;
}

// 구조화 합병증 — PACU 표준 유형
export const PACU_COMPLICATION_TYPES = [
  'AIRWAY', 'RESP_DEPRESSION', 'BLEEDING', 'SHIVERING', 'DELIRIUM', 'HYPOTHERMIA',
  'PONV_SEVERE', 'HYPOTENSION', 'HYPERTENSION', 'ARRHYTHMIA', 'PAIN_UNCONTROLLED',
  // 2026-10-07 — 질 지표가 셀 수 있게 AIRWAY·OTHER 에 뭉쳐 있던 것을 가른다
  'REINTUBATION', 'DESATURATION', 'OTHER',
] as const;

export class AddComplicationDto {
  @ApiProperty({ enum: PACU_COMPLICATION_TYPES }) @IsIn(PACU_COMPLICATION_TYPES as unknown as string[]) type!: string;
  @ApiProperty({ enum: ['MILD', 'MODERATE', 'SEVERE'] }) @IsIn(['MILD', 'MODERATE', 'SEVERE']) severity!: string;
  @ApiPropertyOptional({ description: '중재(처치·약물)' }) @IsOptional() @IsString() @Length(1, 300) intervention?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) note?: string;
}

export class AddPainDto {
  @ApiProperty({ description: '통증 점수 0~10(NRS 등)' }) @IsInt() @Min(0) @Max(10) score!: number;
  @ApiPropertyOptional({ description: '척도(NRS/FLACC/VAS 등)' }) @IsOptional() @IsString() @Length(1, 20) scale?: string;
  @ApiPropertyOptional({ description: '중재(진통제 등)' }) @IsOptional() @IsString() @Length(1, 200) intervention?: string;
}

/**
 * PACU 중재(처치) 유형.
 *
 * 🔴 `pacu_records.interventions` 컬럼은 **입실 때 `[]` 로 만들어지기만 하고 쓰는 EP 가 없었다**
 *    (운영 6건 중 1건에 시드가 넣은 `{drug,action,time}` 이 들어 있는데 화면 어디에도 안 보인다).
 *    합병증(`complications`)은 "무슨 일이 있었나", 중재는 "무엇을 했나" — 다른 사실이라 합치지 않는다.
 *    특히 저체온 가온(WARMING)·산소(OXYGEN)는 회복실에서 가장 흔한 중재인데 남길 곳이 없었다.
 */
export const PACU_INTERVENTION_TYPES = [
  'OXYGEN', 'WARMING', 'MEDICATION', 'FLUID', 'AIRWAY_SUPPORT', 'POSITIONING', 'MONITORING', 'OTHER',
] as const;

export class AddInterventionDto {
  @ApiProperty({ enum: PACU_INTERVENTION_TYPES }) @IsIn(PACU_INTERVENTION_TYPES as unknown as string[]) type!: string;
  @ApiPropertyOptional({ description: '내용(예: 가온담요 적용 · O2 3L/min nasal)' }) @IsOptional() @IsString() @Length(1, 200) detail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) note?: string;
}

export class DischargeDto {
  @ApiProperty({ enum: ['WARD', 'ICU', 'HOME'] }) @IsIn(['WARD', 'ICU', 'HOME']) disposition!: string;
  @ApiPropertyOptional({ description: '퇴실 기준 미달 강제 퇴실 사유(마취과 판단) — WARD/ICU: Aldrete<9, HOME: PADSS<9' })
  @IsOptional() @IsString() @Length(1, 1000) overrideReason?: string;
  // 퇴실 목적지(2026-09-30) — WARD: 다른 병상으로 옮길 때만 · ICU: 먼저 열린 ICU 입실이 없을 때 병상·사유(의사)
  @ApiPropertyOptional({ description: 'WARD — 원 병상 대신 옮길 병상(없으면 원 병상 복귀)' }) @IsOptional() @IsUUID() targetBedId?: string;
  @ApiPropertyOptional({ description: 'ICU — 입실할 ICU 병상(재원 중 ICU 입실이 없을 때)' }) @IsOptional() @IsUUID() icuBedId?: string;
  @ApiPropertyOptional({ description: 'ICU — 입실 사유(새 ICU 입실 때 필수)' }) @IsOptional() @IsString() @Length(1, 500) icuAdmitReason?: string;
  @ApiPropertyOptional({ type: HandoffDto, description: 'PACU→병동/ICU/귀가 인수인계(SBAR)' })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => HandoffDto) dischargeHandoff?: HandoffDto;
}

/** 회복실 섭취·배설(2026-10-07) — 경로는 shared 어휘 · 양은 정수 mL(빈 값 금지 — 0 은 측정된 0) */
export class AddPacuIoDto {
  @ApiProperty({ enum: ['IN', 'OUT'] }) @IsIn(['IN', 'OUT']) kind!: 'IN' | 'OUT';
  @ApiProperty({ enum: [...PACU_IO_ROUTES.IN, ...PACU_IO_ROUTES.OUT] }) @IsIn([...new Set([...PACU_IO_ROUTES.IN, ...PACU_IO_ROUTES.OUT])]) route!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(10000) ml!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) note?: string;
}

/** 회복실 간호기록 한 줄(덧붙이기) */
export class AddPacuNoteDto {
  @ApiProperty() @IsString() @Length(1, 2000) text!: string;
}

/** 퇴실 지연 사유 — null 이면 해제 */
export class SetPacuDelayDto {
  @ApiPropertyOptional({ enum: PACU_DELAY_REASONS, nullable: true }) @IsOptional() @IsIn([...PACU_DELAY_REASONS]) reason?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 300) note?: string;
}

/** 회복실 자리(베이) — 빈 문자열이면 해제 */
export class SetPacuBayDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 10) bayCode?: string;
}
