import {
  IsString, IsOptional, IsNumber, IsUUID, IsNotEmpty,
  IsBoolean, IsIn, IsInt, IsArray, IsDateString, Min, Max, MaxLength, ValidateNested, Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 수술실 등록 ──

export class CreateOperatingRoomDto {
  @ApiProperty({ description: '수술실 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '층' })
  @IsOptional()
  @IsString()
  floor?: string;

  @ApiProperty({ description: '수술실 유형' })
  @IsString()
  @IsNotEmpty()
  roomType: string;

  @ApiPropertyOptional({ description: '장비 목록' })
  @IsOptional()
  equipment?: Record<string, unknown>;
}

// ── 수술실 배정 ──

export class AssignRoomDto {
  @ApiProperty({ description: '수술실 ID' })
  @IsUUID()
  roomId: string;

  @ApiProperty({ description: '수술 ID' })
  @IsUUID()
  surgeryId: string;

  @ApiProperty({ description: '날짜' })
  @IsString()
  @IsNotEmpty()
  date: string;

  /**
   * 🔴 **문자열 시각을 그대로 정렬한다** — 형식이 흔들리면 순서가 무너진다(2026-09-03 운영 실측).
   *    `or_schedules` 에 `9:00` 한 건이 섞여 있었고, 목록이 `startTime` 문자열 오름차순이라
   *    **오전 9시 수술이 15:00 뒤에** 놓였다(`05:09 … 13:00 14:52 15:00 9:00`).
   *    수술 순서가 뒤집혀 보이는 것은 금식·마취 준비와 직결된다.
   *    `HH:MM` 24시간·**0 채움**만 받는다(모르는 형식을 관대하게 받으면 그 관대함이 순서를 깬다).
   */
  @ApiProperty({ description: '시작 시간 (HH:MM · 24시간·0 채움)', example: '09:00' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '시작 시간은 HH:MM 형식이어야 합니다(예: 09:00 — 9:00 불가)' })
  startTime: string;

  @ApiProperty({ description: '종료 시간 (HH:MM · 24시간·0 채움)', example: '11:00' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '종료 시간은 HH:MM 형식이어야 합니다(예: 11:00 — 9:00 불가)' })
  endTime: string;

  @ApiProperty({ description: '예상 소요 시간 (분)' })
  @IsNumber()
  estimatedDuration: number;
}

// ── 마취 기록 생성 ──

export class CreateAnesthesiaRecordDto {
  @ApiProperty({ description: '마취 유형 (GA, spinal, epidural 등)' })
  @IsString()
  @IsNotEmpty()
  anesthesiaType: string;

  @ApiPropertyOptional({ description: 'ASA 분류' })
  @IsOptional()
  @IsString()
  asaClass?: string;

  @ApiPropertyOptional({ description: '기도 유형' })
  @IsOptional()
  @IsString()
  airwayType?: string;

  @ApiPropertyOptional({ description: 'ETT 크기' })
  @IsOptional()
  @IsString()
  ettSize?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 마취 기록 업데이트 ──

export class UpdateAnesthesiaRecordDto {
  @ApiPropertyOptional({ description: '마취 유도 시간' })
  @IsOptional()
  @IsString()
  inductionTime?: string;

  @ApiPropertyOptional({ description: '삽관 시간' })
  @IsOptional()
  @IsString()
  intubationTime?: string;

  @ApiPropertyOptional({ description: '발관 시간' })
  @IsOptional()
  @IsString()
  extubationTime?: string;

  @ApiPropertyOptional({ description: '유도 약물' })
  @IsOptional()
  inductionDrugs?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '유지 약물' })
  @IsOptional()
  maintenanceDrugs?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '진통제' })
  @IsOptional()
  analgesics?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '역전제' })
  @IsOptional()
  reversal?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '수액 투입' })
  @IsOptional()
  fluidInput?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '혈액 제제' })
  @IsOptional()
  bloodProducts?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '추정 실혈량 (mL)' })
  @IsOptional()
  @IsNumber()
  ebl?: number;

  @ApiPropertyOptional({ description: '소변량 (mL)' })
  @IsOptional()
  @IsNumber()
  urineOutput?: number;

  @ApiPropertyOptional({ description: '합병증' })
  @IsOptional()
  complications?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '활력징후' })
  @IsOptional()
  vitalSigns?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// (2026-09-30) PACU 기록 생성·업데이트 DTO 삭제 — 우회 쓰기 EP 와 함께 걷었다(정본 `/api/v1/pacu/*`)

/* ──────────────────────────────────────────────────────────────────────────
 * 🔴 인라인 @Body 승격(2026-08-18) — WHO 체크리스트·마취전평가
 *
 * `PATCH /surgery/:surgeryId/checklist/:phase` 는 `@Body() body: Record<string, boolean>`,
 * `PUT /surgery/:surgeryId/pre-anesthesia` 는 `@Body() dto: Record<string, unknown>` 이라
 * **전역 ValidationPipe 를 통째로 건너뛰었다**. 결과:
 *   · 체크 값이 boolean 이 아니어도(문자열 'false' 등) 서버까지 도달해 Prisma 에서 500 이 났다
 *     — 체크리스트는 마취 유도/절개 직전 화면이다. 500 은 400 보다 나쁘다(원인을 못 읽는다).
 *   · 🔴 `countStatus`(수술 계수 대조)는 게이트가 **정확히 'MISMATCH'** 일 때만 차단하는데
 *     자유문자열이라 `'mismatch'`·`'불일치'` 로 들어오면 **잔류이물 게이트가 조용히 통과**한다.
 *   · 마취전평가의 `cardiacRiskRcri` 는 Int(RCRI 0~6)인데 범위가 없어 임의 정수가 들어갔다.
 *
 * 화면이 실제로 보내는 키(SurgicalChecklistPanel / surgery-prep PreAnesthesiaSection)를
 * 먼저 확인하고 그 키를 하나도 빠뜨리지 않았다 — whitelist 는 DTO 에 없는 키를 조용히 지운다.
 * ────────────────────────────────────────────────────────────────────────── */

/** 수술 계수(count) 품목 1행 — `[{item, initial, final, status}]` */
export class SurgicalCountItemDto {
  @ApiProperty({ description: '품목(거즈·기구 등)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  item: string;

  @ApiProperty({ description: '시작 계수' })
  @IsInt()
  @Min(0)
  initial: number;

  @ApiProperty({ description: '종료 계수' })
  @IsInt()
  @Min(0)
  final: number;

  @ApiPropertyOptional({ description: '품목별 판정', enum: ['MATCH', 'MISMATCH', 'NA'] })
  @IsOptional()
  @IsIn(['MATCH', 'MISMATCH', 'NA'])
  status?: string;
}

/**
 * WHO 수술 안전 체크리스트 단계 갱신.
 * 항목 키는 `SurgeryAdvancedService.CHECKLIST_ITEMS` 정본과 1:1 이다(서버가 화면에 내려주는 그 정의).
 * 세 단계를 한 DTO 로 받는 이유: 서비스가 phase 별 화이트리스트를 이미 갖고 있고,
 * 화면은 항상 **누른 항목 하나만** 보낸다. 전 항목 optional 이 실제 계약이다.
 */
export class UpdateSurgicalChecklistDto {
  // ── Sign-In (마취 유도 전) ──
  @ApiPropertyOptional({ description: '환자 신원 확인' }) @IsOptional() @IsBoolean() patientId?: boolean;
  @ApiPropertyOptional({ description: '수술 부위 표시' }) @IsOptional() @IsBoolean() siteMarked?: boolean;
  @ApiPropertyOptional({ description: '동의서 서명' }) @IsOptional() @IsBoolean() consentSigned?: boolean;
  @ApiPropertyOptional({ description: '마취 안전 점검' }) @IsOptional() @IsBoolean() anesthesiaCheck?: boolean;
  @ApiPropertyOptional({ description: '알레르기 확인' }) @IsOptional() @IsBoolean() allergyCheck?: boolean;
  @ApiPropertyOptional({ description: '맥박산소측정기 부착' }) @IsOptional() @IsBoolean() pulseOximeter?: boolean;
  @ApiPropertyOptional({ description: '예상 출혈량(>500ml)' }) @IsOptional() @IsBoolean() expectedBloodLoss?: boolean;
  @ApiPropertyOptional({ description: '기도관리 위험 평가' }) @IsOptional() @IsBoolean() difficultAirway?: boolean;

  // ── Time-Out (절개 전) ──
  @ApiPropertyOptional({ description: '팀원 소개' }) @IsOptional() @IsBoolean() teamIntro?: boolean;
  @ApiPropertyOptional({ description: '환자명 확인' }) @IsOptional() @IsBoolean() patientName?: boolean;
  @ApiPropertyOptional({ description: '수술명 확인' }) @IsOptional() @IsBoolean() procedure?: boolean;
  @ApiPropertyOptional({ description: '수술 부위 확인' }) @IsOptional() @IsBoolean() site?: boolean;
  @ApiPropertyOptional({ description: '예방적 항생제 투여' }) @IsOptional() @IsBoolean() antibiotics?: boolean;
  @ApiPropertyOptional({ description: '예상 주요 사건 공유' }) @IsOptional() @IsBoolean() criticalEvents?: boolean;
  @ApiPropertyOptional({ description: '필수 영상 게시' }) @IsOptional() @IsBoolean() imagingDisplayed?: boolean;

  // ── Sign-Out (퇴실 전) ──
  @ApiPropertyOptional({ description: '수술명 기록' }) @IsOptional() @IsBoolean() procedureRecorded?: boolean;
  @ApiPropertyOptional({ description: '기구·거즈 계수' }) @IsOptional() @IsBoolean() instrumentCount?: boolean;
  @ApiPropertyOptional({ description: '검체 라벨 확인' }) @IsOptional() @IsBoolean() specimenLabeled?: boolean;
  @ApiPropertyOptional({ description: '회복 계획 공유' }) @IsOptional() @IsBoolean() recoveryPlan?: boolean;
  @ApiPropertyOptional({ description: '장비 문제 점검' }) @IsOptional() @IsBoolean() equipmentIssues?: boolean;

  // ── Sign-Out 계수 대조(P2-D) — 잔류이물(RSI) 방지 ──
  @ApiPropertyOptional({ description: '품목별 계수', type: [SurgicalCountItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SurgicalCountItemDto)
  countItems?: SurgicalCountItemDto[];

  /** 🔴 게이트가 정확히 'MISMATCH' 를 본다 — 자유문자열을 허용하면 게이트가 조용히 열린다. */
  @ApiPropertyOptional({ description: '계수 종합 판정', enum: ['MATCH', 'MISMATCH', 'UNRESOLVED'] })
  @IsOptional()
  @IsIn(['MATCH', 'MISMATCH', 'UNRESOLVED'], { message: 'countStatus 는 MATCH|MISMATCH|UNRESOLVED 여야 합니다' })
  countStatus?: string;

  @ApiPropertyOptional({ description: '불일치 해소(재계수·X-ray) 기록' })
  @IsOptional()
  @IsString()
  countDiscrepancyNote?: string;
}

/**
 * 체크리스트 진행도 일괄 조회 질의.
 * 목록 화면이 표에 찍을 단계별 진행도를 한 번에 받는다(행마다 호출하면 N+1).
 */
export class ChecklistProgressQueryDto {
  @ApiProperty({ description: '수술 ID CSV (최대 200건)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200 * 37)
  surgeryIds: string;
}

/** 마취전평가 — 값 집합은 화면 select 옵션과 동일. 빈 문자열은 **임시 저장**이라 허용한다. */
const ASA_CLASSES = ['1', '2', '3', '4', '5', '6', '2E', '3E', '4E', ''];
const MALLAMPATI = ['I', 'II', 'III', 'IV', ''];
const ANESTHESIA_PLANS = ['GENERAL', 'SPINAL', 'EPIDURAL', 'SEDATION', 'LOCAL', ''];

export class UpsertPreAnesthesiaDto {
  @ApiPropertyOptional({ description: 'ASA 등급(임시 저장 시 빈 값 허용)', enum: ASA_CLASSES })
  @IsOptional()
  @IsIn(ASA_CLASSES, { message: 'asaClass 는 1~6 또는 2E/3E/4E 여야 합니다' })
  asaClass?: string;

  @ApiPropertyOptional({ description: 'Mallampati 기도 등급', enum: MALLAMPATI })
  @IsOptional()
  @IsIn(MALLAMPATI, { message: 'airwayMallampati 는 I~IV 여야 합니다' })
  airwayMallampati?: string;

  @ApiPropertyOptional({ description: '금식(NPO) 확인' })
  @IsOptional()
  @IsBoolean()
  npoConfirmed?: boolean;

  @ApiPropertyOptional({ description: '금식 시작 시각' })
  @IsOptional()
  @IsDateString({}, { message: 'npoSince 는 날짜여야 합니다' })
  npoSince?: string;

  @ApiPropertyOptional({ description: 'RCRI 심장위험지수(0~6)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  cardiacRiskRcri?: number;

  @ApiPropertyOptional({ description: '폐 위험 요약' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pulmonaryRisk?: string;

  @ApiPropertyOptional({ description: '술전검사 리뷰' })
  @IsOptional()
  @IsBoolean()
  labsReviewed?: boolean;

  @ApiPropertyOptional({ description: '마취 동의 확인' })
  @IsOptional()
  @IsBoolean()
  anesthesiaConsent?: boolean;

  @ApiPropertyOptional({ description: '마취 계획', enum: ANESTHESIA_PLANS })
  @IsOptional()
  @IsIn(ANESTHESIA_PLANS, { message: 'plan 은 GENERAL|SPINAL|EPIDURAL|SEDATION|LOCAL 이어야 합니다' })
  plan?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}
