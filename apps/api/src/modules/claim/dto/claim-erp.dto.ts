import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 심사 결과 콜백(ERP/심사→HIS) 수신 DTO — 2026-07 입력 검증 전수검토. */
export class ClaimReviewCallbackDto {
  @ApiPropertyOptional({ description: '청구 ID' })
  @IsOptional()
  @IsUUID()
  claimId?: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '담당의 ID' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiProperty({ description: '심사 결과', enum: ['APPROVED', 'REDUCED', 'REJECTED'] })
  @IsString()
  @IsIn(['APPROVED', 'REDUCED', 'REJECTED'])
  result: string;

  @ApiPropertyOptional({ description: '삭감액(원)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  reducedAmount?: number;

  @ApiPropertyOptional({ description: '사유' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: '심사 일시(ISO8601)' })
  @IsOptional()
  @IsISO8601()
  reviewedAt?: string;
}
