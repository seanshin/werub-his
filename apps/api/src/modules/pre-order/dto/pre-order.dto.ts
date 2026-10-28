import {
  IsString, IsNumber, IsOptional, IsUUID, IsNotEmpty, IsDateString, IsInt, IsBoolean, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 사전 오더 생성 ──

export class CreatePreOrderDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '의사 ID (미입력 시 본인)' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiProperty({ description: '처방 유형 (MEDICATION, LAB, IMAGING, THERAPY, DIET, ACTIVITY, NURSING)' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: '연계 예약 ID ("이 재진에서 시행")' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiPropertyOptional({ description: '활성화 모드 — ON_APPROVAL(기본) | ON_CHECKIN(접수 시 자동·비약물 한정·config 게이트)' })
  @IsOptional()
  @IsString()
  activationMode?: string;

  @ApiPropertyOptional({ description: '반복 간격(일) — 매 N일 (예정일 필수, 1~90)' })
  @IsOptional()
  @IsNumber()
  recurEvery?: number;

  @ApiPropertyOptional({ description: '반복 회차 — 총 M회 (2~12)' })
  @IsOptional()
  @IsNumber()
  recurCount?: number;

  @ApiPropertyOptional({ description: '약물 코드 ID' })
  @IsOptional()
  @IsUUID()
  medicationCodeId?: string;

  @ApiPropertyOptional({ description: '처치 코드 ID' })
  @IsOptional()
  @IsUUID()
  procedureCodeId?: string;

  @ApiPropertyOptional({ description: '용량' })
  @IsOptional()
  @IsString()
  dosage?: string;

  @ApiPropertyOptional({ description: '빈도' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ description: '기간(일)' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ description: '수량' })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ description: '투여경로' })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ description: '우선순위 (ROUTINE, URGENT, STAT)' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ description: '지시사항' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({ description: '사유' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: '예정일' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({ description: '예정시간' })
  @IsOptional()
  @IsString()
  scheduledTime?: string;

  @ApiPropertyOptional({ description: '만료일시' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

// ── 사전 오더 수정 ──

export class ModifyPreOrderDto {
  // 🔴 (B5) 길이·정수는 스키마(PreOrder dosage/frequency VarChar(100)·route VarChar(50)·priority VarChar(20)·duration/quantity Int) — 종전 Prisma 500
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) dosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) frequency?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) route?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;
  /** 수정 사유 — 종전 `@Body('reason')` 원시 추출(검증 스킵). 수정 이력(PreOrderRevision.reason VarChar(300))은 기록이라 자르지 않고 400 */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

// ── 사전 오더 승인 (2026-09-15 B5) ──
// 종전 `@Body('encounterId')`·`@Body('overrideDur')`·`@Body('overrideReason')` 원시 추출 — 검증이 통째로 스킵돼
// 비 uuid encounterId 가 DUR·처방 생성에서 Prisma 500 을 냈다.

export class ApprovePreOrderDto {
  @ApiProperty({ description: '처방을 발행할 진료(Encounter) ID' }) @IsUUID() encounterId: string;
  @ApiPropertyOptional({ description: 'DUR 차단 경고 오버라이드' }) @IsOptional() @IsBoolean() overrideDur?: boolean;
  @ApiPropertyOptional({ description: 'DUR 오버라이드 사유(서비스가 공백 여부를 판정)' }) @IsOptional() @IsString() overrideReason?: string;
}
