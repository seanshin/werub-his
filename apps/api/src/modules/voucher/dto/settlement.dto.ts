import { IsString, IsUUID, IsDateString, IsInt, IsNumber, IsIn, IsOptional, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefundVoucherDto {
  @ApiProperty({ description: '환불 사유' }) @IsString() @MaxLength(200) reason: string;
}

export class GenerateSettlementDto {
  @ApiProperty() @IsUUID() distributorId: string;
  @ApiProperty({ description: '정산 시작(YYYY-MM-DD)' }) @IsDateString() periodStart: string;
  @ApiProperty({ description: '정산 종료(YYYY-MM-DD)' }) @IsDateString() periodEnd: string;
}

// ERP→HIS 정산 지급 회신(settlement.paid 콜백·B3/DB-4)
export class ErpSettlementCallbackDto {
  @ApiProperty({ description: '멱등키 erp:settle-paid:<id>' }) @IsString() @MaxLength(120) event_id: string;
  @ApiPropertyOptional({ description: 'HIS 정산 id(우선 식별자)' }) @IsOptional() @IsUUID() settlementId?: string;
  @ApiPropertyOptional({ description: '딜러 id(settlementId 없을 시 대체키)' }) @IsOptional() @IsUUID() distributorId?: string;
  @ApiPropertyOptional({ description: '기간 YYYY-MM(대체 식별 보조)' }) @IsOptional() @IsString() @MaxLength(7) period?: string;
  @ApiProperty({ enum: ['PAID', 'PARTIAL'] }) @IsIn(['PAID', 'PARTIAL']) status: string;
  @ApiProperty({ description: '지급 시각(ISO8601)' }) @IsDateString() paidAt: string;
  @ApiProperty({ description: 'ERP 지급 전표 추적키' }) @IsString() @MaxLength(120) erpVoucherRef: string;
  @ApiProperty({ description: '실 지급 원화' }) @IsInt() @Min(0) amountPaidKrw: number;
  @ApiPropertyOptional({ description: '원천징수액(DB-1 확정 후)' }) @IsOptional() @IsInt() @Min(0) withholdingKrw?: number;
  @ApiPropertyOptional({ description: '외화 송금 적용 환율' }) @IsOptional() @IsNumber() fxRateApplied?: number;
}
