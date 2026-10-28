import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * 🔴 (2026-09-15 B7) 자격·교육 쓰기 3 핸들러가 인라인 타입이라 ValidationPipe 가 스킵됐다.
 *  - 자격 상태 변경 `status` 는 아무 문자열이나 저장됐다 — 오타(`valid`)는 "유효 자격" 판정에서 빠지고
 *    만료/정지 필터에도 안 걸리는 **어느 쪽도 아닌 자격**이 됐다. 어휘는 스키마 주석 3종(VALID·EXPIRED·SUSPENDED).
 *  - 날짜가 형식 밖이면 `new Date('garbage')` 가 Invalid Date 로 Prisma 500 을 냈다 → 400.
 * 관리 화면(`/admin/sqe`)은 빈 날짜를 `''` 로 보낸다 — 빈 문자열은 미입력으로 받는다(서비스가 이미 그렇게 해석).
 * 자격 종류·교육 분류 어휘는 지어내지 않는다(스키마 주석이 "..." 로 열려 있다 — 길이만).
 */
export const CREDENTIAL_STATUSES = ['VALID', 'EXPIRED', 'SUSPENDED'] as const;
const notBlank = (_: unknown, v: unknown) => v !== undefined && v !== null && v !== '';

export class CreateStaffCredentialDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) type!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) issuer?: string;
  @ApiPropertyOptional() @ValidateIf(notBlank) @IsDateString() issuedAt?: string;
  @ApiPropertyOptional() @ValidateIf(notBlank) @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) fileUrl?: string;
}

export class UpdateStaffCredentialStatusDto {
  @ApiProperty({ enum: CREDENTIAL_STATUSES }) @IsIn(CREDENTIAL_STATUSES) status!: (typeof CREDENTIAL_STATUSES)[number];
}

export class RecordStaffEducationDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) courseName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) category!: string;
  @ApiPropertyOptional() @ValidateIf(notBlank) @IsDateString() completedAt?: string;
  @ApiPropertyOptional() @ValidateIf(notBlank) @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @ValidateIf(notBlank) @IsDateString() dueDate?: string;
  /** Decimal(5,1) */
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(9999.9) hours?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) certificateUrl?: string;
}
