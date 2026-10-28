import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 내성 감시·격리 오더가 `Record<string, unknown>` 본문이라 서비스가 손으로 문자열 변환·자르기를 했다.
 * 🔴 (2026-09-15 U4) 종전엔 서비스가 `slice` 로 자르는 필드에 길이 제한을 두지 않았다 — 감염 감시·격리 기록의 병원체·사유·병실이
 *    조용히 잘려 저장됐다. 임상 기록이라 스키마 길이 그대로 400 으로 알린다(서비스 slice 는 방어로 남음 · 화면 입력칸 maxLength 동반).
 * 격리 유형 어휘 판정(IsolationPrecautionType)은 서비스의 도메인 400 이 그대로 맡는다.
 */
export class CreateResistanceSurveillanceDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) organism!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) resistanceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) specimen?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) ward?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() detectedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) antibioticsTested?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) resistantTo?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) sensitiveTo?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() reportedBy?: string;
}

export class AssignIsolationDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiPropertyOptional({ description: 'IsolationPrecautionType — 미지정 시 CONTACT' }) @IsOptional() @IsString() isolationType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() admissionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) organism?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) roomNumber?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) expectedDurationDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
