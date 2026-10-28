import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsDefined, IsInt, IsOptional, IsString, IsUUID, MaxLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 B5) 검진 접수·서명·단체계약·문진·스테이션 쓰기 13종 — 종전 인라인 타입(ValidationPipe 스킵).
 *
 * - 길이는 스키마 VarChar 근거(`CheckupContract`·`CheckupQuestionnaire`·`CheckupStation`·`CheckupStationLog`·`CheckupResultItem`).
 *   결과·판정은 임상 기록이라 자르지 않고 400(U4) · uuid 는 `@db.Uuid` 근거.
 * - 판정 어휘(finding)·스테이션 분류는 도메인 판정이라 막지 않는다.
 * - 화면이 비움을 `''` 로 보내는 자리(계약 담당자·연락처, 결과 단위·참고치, 문진 programId)는 값이 있을 때만 형식을 본다.
 * - 단체 엑셀 업로드 행은 **형(문자열)만** 본다 — 행별 실패는 서비스가 행 단위로 돌려준다(한 행 오류로 전체 400 을 만들지 않는다).
 * - 문진 `sections`·`answers`·스테이션 `template`·`resultData` 는 Json — 모양은 화면 정본이 갖는다(존재만 본다).
 */
const present = (_: object, v: unknown) => v !== '' && v !== null && v !== undefined;

export class CheckInCheckupVisitDto {
  /** 금액은 서버가 재계산 — 클라이언트는 고른 옵션 id 만 보낸다(미전송=예약 시 저장분) */
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) selectedOptions?: string[];
}

export class SignCheckupSummaryDto {
  /** 강제 서명 — 권한(ADMIN) 판정은 서비스가 한다(DTO 는 형만) */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() force?: boolean;
}

export class CreateCheckupContractDto {
  @ApiProperty() @IsString() @MaxLength(200) companyName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) contactPerson?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiProperty() @IsUUID() programId!: string;
  @ApiProperty() @IsInt() headcount!: number;
  @ApiProperty({ description: '할인율(%)' }) @IsInt() discountRate!: number;
  @ApiProperty({ example: '2026-09-15' }) @IsDateString() contractDate!: string; // @db.Date — 종전 Invalid Date → Prisma 500
  @ApiProperty({ example: '2027-09-14' }) @IsDateString() expiryDate!: string;
}

export class CheckupBulkReservationDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ example: '2026-09-20' }) @IsDateString() scheduledDate!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) selectedOptions?: string[];
}

export class BulkReserveCheckupDto {
  @ApiProperty({ type: [CheckupBulkReservationDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => CheckupBulkReservationDto)
  reservations!: CheckupBulkReservationDto[];
}

export class CheckupBulkUploadRowDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() dateOfBirth!: string;
  @ApiProperty() @IsString() gender!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiProperty() @IsString() scheduledDate!: string;
}

export class BulkUploadCheckupDto {
  @ApiProperty({ type: [CheckupBulkUploadRowDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => CheckupBulkUploadRowDto)
  rows!: CheckupBulkUploadRowDto[];
}

export class CheckupStationCompleteItemDto {
  @ApiProperty() @IsUUID() visitId!: string;
  @ApiProperty() @IsString() @MaxLength(200) testName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) value?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) referenceRange?: string;
  @ApiProperty() @IsString() @MaxLength(20) finding!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class CreateCheckupQuestionnaireDto {
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID() programId?: string;
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ description: '섹션 Json' }) @IsDefined() sections!: unknown;
}

export class UpdateCheckupQuestionnaireDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional({ description: '섹션 Json' }) @IsOptional() sections?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SaveCheckupQuestionnaireResponseDto {
  @ApiProperty() @IsUUID() questionnaireId!: string;
  @ApiProperty({ description: '응답 Json' }) @IsDefined() answers!: unknown;
}

export class UpdateCheckupStationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  /** 공간 정본 연결(P0-5) — uuid=연결 · null=연결 해제 · 미전송=그대로 */
  @ApiPropertyOptional({ nullable: true, description: 'SpaceNode id(층·구역) · null=연결 해제' })
  @IsOptional() @ValidateIf((o) => o.spaceNodeId !== null) @IsUUID() spaceNodeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() avgMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() capacity?: number;
  @ApiPropertyOptional({ description: '입력 템플릿 Json' }) @IsOptional() template?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CheckupWsArriveDto {
  @ApiProperty({ example: 'ck-blood' }) @IsString() @MaxLength(30) stationId!: string;
}

export class CheckupWsStartDto {
  @ApiProperty() @IsString() @MaxLength(30) stationId!: string;
  /** 미전송=로그인 사용자 · 대리 시행자 지정은 막지 않는다(절차 우회 목록에 보고) */
  @ApiPropertyOptional() @IsOptional() @IsUUID() operatorId?: string;
}

export class CheckupWsCompleteDto {
  @ApiProperty() @IsString() @MaxLength(30) stationId!: string;
  @ApiPropertyOptional({ description: '측정값 Json' }) @IsOptional() resultData?: unknown;
  @ApiProperty() @IsString() @MaxLength(20) finding!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
  @ApiPropertyOptional({ type: [String], description: '이 스테이션이 실제로 시행한 검사' }) @IsOptional() @IsArray() @IsString({ each: true }) testNames?: string[];
}
