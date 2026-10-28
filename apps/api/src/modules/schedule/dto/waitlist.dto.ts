import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * (2026-09-15 B10) 직원 대기자 등록 — 인라인 본문이었다. 희망 시작·끝이 날짜가 아니면 `new Date()` 가 Invalid Date 로 Prisma 500,
 * uuid 아닌 환자·의사 id 도 500 이었다. 등록자(`createdBy`)는 본문이 아니라 로그인 사용자다.
 */
export class RegisterWaitlistDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) departmentName: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() doctorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() preferredFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() preferredTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
