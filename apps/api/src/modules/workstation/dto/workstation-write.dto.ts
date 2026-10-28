import {
  IsArray, IsBoolean, IsDateString, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 🔴 (2026-09-15 B9) 워크스테이션 쓰기 6 EP — 인라인 타입이라 ValidationPipe 가 통째로 건너뛰었다.
 *  · 촬영 완료 `overrideSafety: "false"`(문자열)는 **참**으로 읽혀 영상 시행 전 안전게이트(임신·조영제 등) 강제 시행으로 넘어갔다
 *  · 선량(`dlp` 등) 문자열은 피폭 원장에 숫자 아닌 값으로 가 500 · 반복 오더 `isRecurring: "false"` 도 참
 *  · 촬영자·판독자·오더 입력자는 로그인 사용자(컨트롤러) — 본문으로 받지 않는다
 * 어휘(modality·quality·치료 유형)는 게이트·서비스 정본이 판정한다 — 여기서 지어내 강제하지 않는다(컬럼 길이만).
 */
export class AcquireImagingDto {
  @IsOptional() @IsString() @MaxLength(128) dicomStudyUid?: string;
  @IsOptional() @IsString() @MaxLength(20) quality?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() @MaxLength(50) modality?: string;
  @IsOptional() @IsString() @MaxLength(100) bodyPart?: string;
  @IsOptional() @IsBoolean() overrideSafety?: boolean;
  @IsOptional() @IsString() @MaxLength(500) overrideReason?: string;
  @IsOptional() @IsNumber() @Min(0) dlp?: number;
  @IsOptional() @IsNumber() @Min(0) ctdiVol?: number;
  @IsOptional() @IsNumber() @Min(0) doseAreaProduct?: number;
  @IsOptional() @IsNumber() @Min(0) effectiveDoseMsv?: number;
}

export class ReportImagingDto {
  @IsString() @IsNotEmpty() finding!: string;
  @IsString() @IsNotEmpty() conclusion!: string;
  @IsOptional() @IsString() recommendation?: string;
}

export class LabTemplateItemInputDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(50) unit?: string;
  @IsOptional() @IsString() @MaxLength(100) refRange?: string;
  @IsOptional() @IsInt() @Min(0) decimalPlaces?: number;
}

export class CreateLabTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(20) procedureCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) testName!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) stationId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LabTemplateItemInputDto) items!: LabTemplateItemInputDto[];
}

/** 수정 — 화면은 생성 폼 전체(`procedureCode` 포함)를 보낸다. 코드는 경로가 정본이라 본문 값은 쓰지 않는다 */
export class UpdateLabTemplateDto {
  @IsOptional() @IsString() @MaxLength(20) procedureCode?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) testName?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30) stationId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LabTemplateItemInputDto) items?: LabTemplateItemInputDto[];
}

export class CreateTherapyOrderDto {
  @IsUUID() encounterId!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) therapyType!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) stationId!: string;
  @IsDateString() scheduledDate!: string;
  @IsOptional() @IsString() @MaxLength(10) scheduledTime?: string;
  @IsOptional() @IsInt() @Min(1) duration?: number;
  @IsOptional() @IsUUID() therapistId?: string;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  @IsOptional() @IsString() @MaxLength(50) recurPattern?: string;
  @IsOptional() @IsDateString() recurEndDate?: string;
  @IsOptional() @IsInt() @Min(1) totalSessions?: number;
  @IsOptional() @IsString() instructions?: string;
}

/** 치료 세션 완료 — 결과는 구조화 객체(자유 키) · 완료자는 로그인 사용자 */
export class CompleteTherapySessionDto {
  @IsObject() resultData!: Record<string, unknown>;
}

/** 검체 채취 기록(2026-10-01) — 시각을 주지 않으면 지금(채취하며 누름) · 주면 나중 입력(출처를 남긴다) */
export class RecordSpecimenCollectionDto {
  @IsOptional()
  @IsISO8601()
  collectedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
