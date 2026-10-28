import { Allow, IsArray, IsBoolean, IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 U2) GLD 위원회·회의·정책 쓰기 7종 — 종전 인라인 타입 4 + `@Body() body: any` 3.
 *
 * - `updateCommittee` 는 `patch = { ...data }` 를 그대로 `committee.update` 에 넣었다 → **본문 전체가 Prisma data**.
 *   `id`·`createdAt` 은 물론 관계 중첩 쓰기(`members: { create: … }`)까지 열려 있었다(mass assignment).
 *   DTO 가 서비스가 읽는 9개 키만 남긴다(whitelist).
 * - VarChar 길이는 스키마 근거 · uuid 는 `@db.Uuid` 근거(비 uuid 는 Prisma 500 이었다).
 * - 🔴 **빈 문자열을 막지 않는다** — 화면(admin/gld)이 `chairId:''`·`committeeId:''`·`reviewDate:''`·`location:''` 을 보내고
 *   서비스가 `|| undefined`·`? … : undefined` 로 "미지정"으로 읽는다. 그래서 형식 검사는 **값이 있을 때만**(ValidateIf).
 * - 어휘(type·category·status·meetingCycle)는 스키마 주석뿐이라 막지 않는다. 위원 역할은 서비스가 대문자화 후 정본 대조한다.
 * - code 는 서비스가 trim·대문자화 후 `^[A-Z0-9_]{2,20}$` 로 검사한다 — 원문에 길이 상한을 따로 두지 않는다.
 */
const present = (_: object, v: unknown) => v !== '' && v !== null && v !== undefined;

export class CreateCommitteeDto {
  @ApiProperty() @IsString() @MaxLength(150) name!: string;
  @ApiProperty({ description: 'QUALITY·SAFETY·INFECTION… (스키마 주석)' }) @IsString() @MaxLength(40) type!: string;
  @ApiPropertyOptional({ description: '거버넌스 관제 키(서비스가 대문자화·형식 검사)' }) @IsOptional() @IsString() code?: string;
  @ApiPropertyOptional({ description: '정족수(서비스가 0 이상 정수로 접는다)' }) @IsOptional() @Type(() => Number) @IsNumber() quorum?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() purpose?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() charter?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) meetingCycle?: string;
  @ApiPropertyOptional({ description: "위원장 계정 id — '' 는 미지정" }) @ValidateIf(present) @IsUUID() chairId?: string;
}

export class UpdateCommitteeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) name?: string;
  /** `null`·'' = 관제 키 제거(서비스) */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() code?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() quorum?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() purpose?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() charter?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) meetingCycle?: string;
  /** `null`·'' = 위원장 해제(화면 governance 가 `{chairId:null}` 을 보낸다) */
  @ApiPropertyOptional({ nullable: true }) @ValidateIf(present) @IsUUID() chairId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AddCommitteeMemberDto {
  @ApiProperty({ description: '사용자 계정 id' }) @IsUUID() userId!: string;
  @ApiPropertyOptional({ description: 'CHAIR·VICE_CHAIR·SECRETARY·MEMBER — 서비스가 대문자화 후 정본 대조' }) @IsOptional() @IsString() role?: string;
}

export class CreateMeetingDto {
  @ApiProperty() @IsUUID() committeeId!: string;
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ example: '2026-09-15T10:00' }) @IsDateString() scheduledAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() agenda?: string;
  /** 🔴 화면(admin/governance 의결 회의)이 보내는 키 — 종전 인라인 타입엔 없었다. 원소 검사는 서비스(normalizeAttendees)가 한다 */
  @ApiPropertyOptional({ type: [String], description: '참석자 계정 id 배열' }) @IsOptional() @IsArray() attendees?: unknown[];
}

export class UpdateMeetingDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsDateString() scheduledAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() agenda?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() minutes?: string;
  /** ⚠️ deprecated(P0-b) JSON — 서비스가 아직 받으므로 보존(형태 검사 근거 없음) */
  @ApiPropertyOptional() @Allow() decisions?: unknown;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() attendees?: unknown[];
  @ApiPropertyOptional({ description: 'SCHEDULED·COMPLETED·CANCELLED (스키마 주석)' }) @IsOptional() @IsString() @MaxLength(20) status?: string;
}

export class CreatePolicyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ description: 'CLINICAL·ADMIN·SAFETY… (스키마 주석)' }) @IsString() @MaxLength(40) category!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID() committeeId?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsDateString() effectiveDate?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsDateString() reviewDate?: string;
}

/**
 * 🔴 `status` 를 본문으로 받는다 — `ACTIVE` 로 올리면 `approvePolicy`(approvedBy·approvedAt 기록)를 거치지 않고 시행된다.
 *    둘 다 ADMIN 전용이고 막는 것은 절차 정책 결정이라 이번 범위에서 막지 않는다(보고에 기록). 호출 화면 0.
 */
export class UpdatePolicyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional({ description: 'DRAFT·ACTIVE·UNDER_REVIEW·ARCHIVED (스키마 주석)' }) @IsOptional() @IsString() @MaxLength(20) status?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsDateString() reviewDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) version?: string;
}
