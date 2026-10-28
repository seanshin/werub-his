import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 B10) 표준코드 매핑 검토 5 핸들러 — 인라인 본문이었다.
 *  - Stage 4 확정: `selectedCode` 가 없거나 후보에 없으면 서비스가 **첫 후보로 조용히 확정**했다
 *    (사람이 고르지 않은 표준코드가 `AI_REVIEWED` 로 봉인됨) — 이제 필수 + 후보 밖이면 400(서비스).
 *  - 부서 배정: 우선순위 어휘는 스키마 주석(HIGH·NORMAL·LOW) · 부서는 VarChar(50) — 넘으면 Prisma 500 이었다.
 * 검토자·검토 역할은 본문이 아니라 로그인 사용자다.
 */
export class ConfirmPendingMappingDto {
  @ApiProperty({ description: '후보 중 선택한 표준코드' }) @IsString() @IsNotEmpty() @MaxLength(100) selectedCode: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class MappingReviewNotesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class AssignMappingDepartmentDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) department: string;
  @ApiPropertyOptional({ enum: ['HIGH', 'NORMAL', 'LOW'] }) @IsOptional() @IsIn(['HIGH', 'NORMAL', 'LOW']) priority?: string;
}
