import { Allow, IsBoolean, IsDateString, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 B4) CRM 쓰기 11종 — 종전 인라인 타입 7 + `Record<string, unknown>` 4.
 *
 * - 수정 4종(캠페인·템플릿·해외환자 케이스·포털 배너)은 `@Body() body: Record<string, unknown>` 을 `body as any` 로
 *   서비스에 넘겼고, 서비스가 그것을 **그대로 Prisma `update({ data })`** 에 넣었다(mass assignment).
 *   캠페인은 `status:'COMPLETED'`·`sentCount`·`createdBy` 를, 배너는 `clickCount`·`impressionCount` 를,
 *   케이스는 `patientId` 를 본문으로 바꿀 수 있었다. DTO 는 서비스가 읽는 키만 남긴다(whitelist) —
 *   서비스도 읽는 키만 골라 Prisma 로 보낸다(DTO 를 거치지 않은 호출 방어).
 * - 길이는 스키마 VarChar 근거 · uuid 는 `@db.Uuid` 근거(비 uuid 는 Prisma 500 이었다) · 금액은 Decimal(12,0) 근거.
 * - 어휘(type·channel·status·direction·source·linkType·packageType)는 스키마 주석뿐이라 막지 않는다.
 * - 선택 uuid·날짜는 **값이 있을 때만** 형식 검사(ValidateIf) — `null` 은 "비움"으로 서비스까지 간다.
 * - NOT NULL 컬럼의 선택 키는 `null` 을 통과시키지 않는다(`given`) — 종전 `null` 은 Prisma 500 이었다.
 */
const present = (_: object, v: unknown) => v !== '' && v !== null && v !== undefined;
const given = (_: object, v: unknown) => v !== undefined;
const DECIMAL_12_0_MAX = 999_999_999_999;

// ── 캠페인 ──

export class CreateCrmCampaignDto {
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiProperty({ description: 'REMINDER·RECALL·PROMOTION… (스키마 주석)' }) @IsString() @MaxLength(30) type!: string;
  @ApiProperty({ description: 'SMS·PUSH·PORTAL·EMAIL… (스키마 주석)' }) @IsString() @MaxLength(20) channel!: string;
  @ApiProperty() @IsString() content!: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID() segmentId?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID() templateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subject?: string;
  /** JSON 변수 맵 — 형태 검사 근거 없음(서비스가 그대로 저장) */
  @ApiPropertyOptional() @Allow() variables?: unknown;
  @ApiPropertyOptional({ example: '2026-09-20T09:00:00+09:00' }) @ValidateIf(present) @IsDateString() scheduledAt?: string;
}

/** DRAFT 에서만 수정(서비스) — 상태·발송 집계·작성자는 본문으로 바꾸지 않는다 */
export class UpdateCrmCampaignDto {
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(30) type?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(20) channel?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsString() content?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf(present) @IsUUID() segmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf(present) @IsUUID() templateId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf(present) @IsDateString() scheduledAt?: string | null;
}

// ── 세그먼트·템플릿 ──

export class CreateCrmSegmentDto {
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ description: 'MANUAL·AUTO·RFM (스키마 주석)' }) @IsString() @MaxLength(20) type!: string;
  /** 규칙 맵 — `buildSegmentWhere` 가 키로 읽는다(미지원 키는 서비스가 따로 말한다). Json NOT NULL */
  @ApiProperty({ example: { churnRisk: 'HIGH' } }) @IsObject() rules!: Record<string, unknown>;
}

export class CreateCrmTemplateDto {
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiProperty() @IsString() @MaxLength(30) type!: string;
  @ApiProperty() @IsString() @MaxLength(20) channel!: string;
  @ApiPropertyOptional({ description: 'ko·en·zh… (기본 ko)' }) @ValidateIf(given) @IsString() @MaxLength(5) locale?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @ApiProperty() @IsString() content!: string;
}

export class UpdateCrmTemplateDto {
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(30) type?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(20) channel?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(5) locale?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsString() content?: string;
}

// ── 마케팅 동의 ──

export class UpdateCrmPatientConsentDto {
  @ApiProperty() @IsString() @MaxLength(20) channel!: string;
  @ApiProperty() @IsString() @MaxLength(30) type!: string;
  @ApiProperty() @IsBoolean() consented!: boolean;
  @ApiPropertyOptional({ description: 'PORTAL·APP·RECEPTION·PHONE (스키마 주석)' }) @IsOptional() @IsString() @MaxLength(30) source?: string;
}

// ── 해외환자 케이스 ──

export class CreateForeignCaseDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ description: 'WEBSITE·AGENCY·REFERRAL… (스키마 주석)' }) @IsString() @MaxLength(30) source!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) agencyName?: string;
  @ApiPropertyOptional({ example: '2026-09-20' }) @ValidateIf(present) @IsDateString() arrivalDate?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsDateString() departureDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) accommodation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) interpreterLang?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) packageType?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Max(DECIMAL_12_0_MAX) estimatedCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

/** 환자·접수 경로(source)는 수정으로 바꾸지 않는다(서비스 수정 계약에 없음) */
export class UpdateForeignCaseDto {
  @ApiPropertyOptional({ description: 'INQUIRY·QUOTED·CONFIRMED… (스키마 주석)' }) @ValidateIf(given) @IsString() @MaxLength(20) status?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsUUID() assignedTo?: string;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf(present) @IsDateString() arrivalDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf(present) @IsDateString() departureDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) accommodation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) interpreterLang?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) packageType?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Max(DECIMAL_12_0_MAX) estimatedCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Max(DECIMAL_12_0_MAX) actualCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() satisfactionScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

// ── 소통 이력 ──

export class LogCrmCommunicationDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ description: 'SMS·PUSH·PORTAL·EMAIL·CALL·VISIT (스키마 주석)' }) @IsString() @MaxLength(20) channel!: string;
  @ApiProperty({ description: 'OUTBOUND·INBOUND (스키마 주석)' }) @IsString() @MaxLength(10) direction!: string;
  @ApiProperty() @IsString() @MaxLength(30) type!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiProperty() @IsString() @MaxLength(20) status!: string;
}

// ── 포털 배너 ──

export class CreatePortalBannerDto {
  @ApiProperty({ description: 'MAIN_BANNER·POPUP·INLINE·PUSH_BANNER (스키마 주석)' }) @IsString() @MaxLength(20) type!: string;
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) linkUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) linkType?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID() segmentId?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsBoolean() targetAll?: boolean;
  /** NOT NULL 컬럼 — 종전 `new Date(undefined)` 는 Invalid Date → Prisma 500 */
  @ApiProperty() @IsDateString() publishFrom!: string;
  @ApiProperty() @IsDateString() publishUntil!: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsBoolean() showOncePerDay?: boolean;
  @ApiPropertyOptional() @ValidateIf(given) @IsInt() sortOrder?: number;
}

/** 노출·클릭 집계와 작성자는 본문으로 바꾸지 않는다 */
export class UpdatePortalBannerDto {
  @ApiPropertyOptional() @ValidateIf(given) @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) linkUrl?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsDateString() publishFrom?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsDateString() publishUntil?: string;
  @ApiPropertyOptional() @ValidateIf(given) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @ValidateIf(given) @IsInt() sortOrder?: number;
}
