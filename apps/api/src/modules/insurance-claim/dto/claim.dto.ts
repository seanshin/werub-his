import { IsString, IsOptional, IsUUID, IsInt, IsPositive, IsIn, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClaimDto {
  @ApiProperty({ description: '청구서 ID' })
  @IsUUID()
  billingId: string;

  @ApiPropertyOptional({ description: '청구 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SubmitClaimDto {
  @ApiPropertyOptional({ description: 'EDI 형식 데이터' })
  @IsOptional()
  @IsString()
  ediData?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReviewClaimDto {
  // 🔴 (P2-4) 종전 `@IsString()` 만 — 모르는 문자열(예 'APPROVE')이 반려(REJECTED)로 저장됐다
  @ApiProperty({ description: '승인/거절 여부' })
  @IsIn(['approve', 'reject', 'partial_approve'])
  action: 'approve' | 'reject' | 'partial_approve';

  // 🔴 (P2-4) 종전 `@IsPositive()` — 반려(인정 0)를 기록할 수 없었다. 결과별 금액 규칙은 서비스가 본다
  @ApiProperty({ description: '승인 금액' })
  @IsInt()
  @Min(0)
  approvedAmount: number;

  @ApiPropertyOptional({ description: '거절/감액 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateClaimDataDto {
  @ApiPropertyOptional({ description: '청구 데이터 (JSON)' })
  @IsOptional()
  claimData?: Record<string, any>;

  @ApiPropertyOptional({ description: '감액 금액' })
  @IsOptional()
  @IsInt()
  @Min(0)
  reducedAmount?: number;
}

export class RecordPaymentDto {
  // 🔴 (P2-4) 종전 `@IsNumber()` — 0·음수·소수도 PAID 로 기록됐다
  @ApiProperty({ description: '지급 금액' })
  @IsInt()
  @IsPositive()
  paidAmount: number;
}
