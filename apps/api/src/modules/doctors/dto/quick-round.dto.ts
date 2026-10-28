import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * (2026-09-15 B10) 빠른 회진 기록 — 인라인 본문이었다. uuid 아닌 입원 id·20자 넘는 회진 유형은 Prisma 500 이었다.
 * 회진 의사(`doctorId`)는 본문이 아니라 로그인 사용자다. 회진 유형 어휘는 강제하지 않는다(컬럼 길이만).
 */
export class QuickRoundDto {
  @ApiProperty() @IsUUID() admissionId: string;
  @ApiProperty({ description: '평가(화면은 비어 있으면 저장 버튼을 막는다)' }) @IsString() assessment: string;
  @ApiProperty({ description: '계획(빈 문자열 허용 — 화면이 평가만 적고 보낸다)' }) @IsString() plan: string;
  @ApiPropertyOptional({ description: '메모로 저장' }) @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ description: '기본 MORNING' }) @IsOptional() @IsString() @MaxLength(20) roundType?: string;
}
