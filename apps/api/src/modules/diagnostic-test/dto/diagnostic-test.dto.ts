import {
  IsString, IsOptional, IsNotEmpty, IsUUID, IsIn, IsInt, Min, IsBoolean, Length,
  IsArray, ArrayUnique, IsObject, ArrayMaxSize, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DIAGNOSTIC_TEST_TYPE_CODES, DIAGNOSTIC_CONCLUSION_CODES } from '@hospital-run/shared';

// ── 검사 의뢰 ──

export class CreateDiagnosticTestDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '검사 유형' })
  @IsString()
  @IsNotEmpty()
  testType: string;

  @ApiProperty({ description: '검사명' })
  @IsString()
  @IsNotEmpty()
  testName: string;

  @ApiPropertyOptional({ description: '예정 일시 (ISO)' })
  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: ['STAT', 'URGENT', 'ROUTINE'] }) @IsOptional() @IsIn(['STAT', 'URGENT', 'ROUTINE']) priority?: string;
  @ApiPropertyOptional({ description: '목표 소요시간(분)' }) @IsOptional() @IsInt() @Min(1) targetTatMinutes?: number;
  // 🔴 의뢰 화면이 "특이사항·금식 여부·알레르기" 를 입력받고 있었는데 DTO 에 필드가 없어
  //    전송조차 되지 않고 사라졌다(2026-08-26 실측).
  @ApiPropertyOptional({ description: '의뢰 메모(금식·알레르기·특이사항)' })
  @IsOptional() @IsString() @Length(1, 500) requestNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) roomName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) equipmentName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
}

// ── P2: 판독 검토(서명) ──
export class ReviewDiagnosticTestDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) note?: string;
}

// ── P2: 상태 전이(취소/보류) ──
// 전이표·사유 필수 여부는 shared `DIAGNOSTIC_TEST_TRANSITIONS`·`DIAGNOSTIC_TEST_REASON_REQUIRED` 가 정본 — DTO 는 값 모양만 본다
export class TransitionDto {
  @ApiProperty({ enum: ['CANCELLED', 'ON_HOLD', 'SCHEDULED', 'ORDERED'], description: 'ORDERED·SCHEDULED 는 보류 해제 목적지' })
  @IsIn(['CANCELLED', 'ON_HOLD', 'SCHEDULED', 'ORDERED']) status: string;
  @ApiPropertyOptional({ description: '취소·보류는 필수(서버가 검증)' }) @IsOptional() @IsString() @Length(1, 300) reason?: string;
  @ApiPropertyOptional({ description: '결과가 기록된 검사를 취소할 때 — 결과가 남아 있음을 확인했다' })
  @IsOptional() @IsBoolean() acknowledgeResult?: boolean;
}

// ── 판독 결과 입력 ──

export class ReportDiagnosticTestDto {
  @ApiPropertyOptional({ description: '소견' })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({ description: '인상 (impression)' })
  @IsOptional()
  @IsString()
  impression?: string;

  // 🔴 결론은 정본 어휘로만 받는다 — 화면마다 다른 문자열이 들어오면 보드·추이 집계가 갈라진다.
  @ApiPropertyOptional({ description: '결론', enum: DIAGNOSTIC_CONCLUSION_CODES as string[] })
  @IsOptional()
  @IsIn(DIAGNOSTIC_CONCLUSION_CODES as string[])
  conclusion?: string;

  @ApiPropertyOptional({ description: '측정값 (JSON)' })
  @IsOptional()
  @IsObject()
  measurements?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '위험소견 플래그' }) @IsOptional() @IsBoolean() criticalFlag?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 300) criticalNote?: string;
}

// ── 자리(스테이션) 설정 — 이 자리에서 무슨 검사를 하는가 ──

/**
 * 🔴 `testTypes` 는 **정본 어휘(`DIAGNOSTIC_TEST_TYPE_CODES`)로만** 받는다.
 *    운영 `workstation_configs.order_codes` 에 이미 들어 있던 `ECG`·`EGD`·`PTA` 는
 *    검사 종류(`EKG`·`ENDOSCOPY_UPPER`·`AUDIOMETRY`)와 교집합이 0 이라 큐가 영원히 비었다.
 *    자유 문자열을 계속 받으면 같은 일이 반복된다.
 */
export class UpdateStationTestTypesDto {
  @ApiProperty({ description: '이 자리에서 시행하는 검사 종류 코드', isArray: true, enum: DIAGNOSTIC_TEST_TYPE_CODES as string[] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(40)
  @IsIn(DIAGNOSTIC_TEST_TYPE_CODES as string[], { each: true })
  testTypes: string[];

  @ApiPropertyOptional({ description: '자리 이름(검사실명)' })
  @IsOptional() @IsString() @Length(1, 100) label?: string;

  @ApiPropertyOptional({ description: '위치(층·구역)' })
  @IsOptional() @IsString() @Length(1, 100) location?: string;
}

// ── 검사값(측정값) 저장 — 판독 완료 전 ──

/**
 * 진행 중인 검사의 측정값만 먼저 저장한다(판독·완료는 하지 않는다).
 * 🔴 검사값을 판독과 한 몸으로 묶으면, 판독의가 오기 전에 기사가 잰 값이 화면 밖에서 사라진다.
 */
export class SaveMeasurementsDto {
  @ApiProperty({ description: '측정값 { 항목키: 값 } — 빈 문자열은 저장하지 않는다(미입력)' })
  @IsObject()
  measurements: Record<string, unknown>;

  @ApiPropertyOptional({ description: '측정을 시행한 자리(스테이션) ID' })
  @IsOptional() @IsString() @Length(1, 30) @Matches(/^[a-z0-9-]+$/) stationId?: string;
}

// ── 검사 시행 시작 ──

export class PerformDiagnosticTestDto {
  @ApiPropertyOptional({ description: '시행 자리(스테이션) ID — 검사실명이 기록에 남는다' })
  @IsOptional() @IsString() @Length(1, 30) @Matches(/^[a-z0-9-]+$/) stationId?: string;
}

/**
 * 자리 신설 — 정본 11종 중 어느 자리에도 배정되지 않은 검사(뇌파·수면다원·골밀도·대장내시경 등)에
 * 담당 자리를 만들 수 있어야 한다. 워크리스트가 없으면 그 검사는 아무 화면에도 뜨지 않는다.
 *
 * 🔴 `stationId` 는 `diag-` 로 시작해야 한다 — 검사실(`lab-`)·영상실(`img-`) 자리 ID 를
 *    덮어쓰면 그쪽 큐의 어휘(수가코드)가 파괴된다.
 */
export class CreateDiagnosticStationDto {
  @ApiProperty({ description: '자리 ID (diag- 로 시작)', example: 'diag-eeg' })
  @IsString() @Matches(/^diag-[a-z0-9-]{1,24}$/, { message: 'stationId 는 diag- 로 시작하는 소문자·숫자·하이픈이어야 합니다' })
  stationId: string;

  @ApiProperty({ description: '자리 이름(검사실명)' })
  @IsString() @IsNotEmpty() @Length(1, 100) label: string;

  @ApiProperty({ description: '담당 진료과·부서' })
  @IsString() @IsNotEmpty() @Length(1, 50) department: string;

  @ApiPropertyOptional({ description: '위치(층·구역)' })
  @IsOptional() @IsString() @Length(1, 100) location?: string;

  @ApiProperty({ description: '이 자리에서 시행하는 검사 종류 코드', isArray: true, enum: DIAGNOSTIC_TEST_TYPE_CODES as string[] })
  @IsArray() @ArrayUnique() @ArrayMaxSize(40)
  @IsIn(DIAGNOSTIC_TEST_TYPE_CODES as string[], { each: true })
  testTypes: string[];
}
