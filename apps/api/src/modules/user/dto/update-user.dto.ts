import { IsString, IsEnum, IsOptional, IsBoolean, MaxLength, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CLINICAL_PROFESSIONS } from '@hospital-run/shared';

/**
 * 🔴 (2026-09-15 T2) 사용자 수정 — 종전 컨트롤러가 `Record<string, unknown>` 로 받고 서비스가 `{ ...dto }` 를 그대로
 * `prisma.user.update` 에 펼쳤다. ValidationPipe 가 스킵돼 **본문의 어떤 User 컬럼이든**(email·passwordHash·mfa 등)
 * 관리자 수정 요청으로 덮어쓸 수 있었다(대량 할당). 서비스 시그니처가 받는 필드만 둔다 — 나머지는 whitelist 가 지운다.
 */
export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() familyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() givenName?: string;
  @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
  /** 정책 검사(assertPasswordPolicy)는 서비스 정본이 한다 */
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) specialty?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  /**
   * 직종(오더 입력 범위) — shared CLINICAL_PROFESSIONS. null 이면 해제(역할 기본 직종).
   * 역할과 맞는지(PROFESSION_ROLE)는 서비스가 검사한다 — 맞지 않으면 400.
   */
  @ApiPropertyOptional({ nullable: true, enum: CLINICAL_PROFESSIONS })
  @IsOptional()
  @IsIn([...CLINICAL_PROFESSIONS])
  profession?: string | null;
}

/** 내 서명 이미지 — null 은 삭제. 형식·크기(PNG/JPEG data URL·3MB) 판정은 서비스 정본 */
export class SaveMySignatureDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() signatureImage!: string | null;
}
