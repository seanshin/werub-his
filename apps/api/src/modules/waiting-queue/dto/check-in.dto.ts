import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 B10) 접수(대기열 생성) — 인라인 본문이었다.
 *  - `departmentName` 이 없으면 중복 접수 검사의 `where.departmentName` 이 `undefined`(= 조건 없음)가 되어
 *    **다른 과의 활성 대기**가 걸려 "이미 접수된 환자입니다 (undefined 대기 #n)" 로 막혔고, 통과해도 생성에서 Prisma 500 이었다.
 *  - uuid 아닌 환자·의사·예약 id 는 Prisma 500 이었다.
 * 방문·접수 유형 어휘는 강제하지 않는다(내부 경로가 CHECKUP·FOLLOW_UP 등 여러 값을 쓴다) — 컬럼 길이(VarChar 20·100)만.
 */
export class QueueCheckInDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiPropertyOptional({ description: '미지정 시 자동 배정' }) @IsOptional() @IsUUID() doctorId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) departmentName: string;
  @ApiPropertyOptional({ description: '기본 INITIAL' }) @IsOptional() @IsString() @MaxLength(20) visitType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() appointmentId?: string;
  @ApiPropertyOptional({ description: '기본 예약 있으면 APPOINTMENT·없으면 WALK_IN' }) @IsOptional() @IsString() @MaxLength(20) type?: string;
}
