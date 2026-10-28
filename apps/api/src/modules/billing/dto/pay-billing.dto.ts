import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PayBillingDto {
  @ApiProperty({ description: '수납 금액 (원)', example: 15000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount: number;

  @ApiProperty({ description: '결제 수단', example: 'CARD', enum: ['CARD', 'CASH', 'TRANSFER', 'DEPOSIT', 'VOUCHER'] })
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @ApiPropertyOptional({ description: '검진권 시리얼 (paymentMethod=VOUCHER 시 필수)' })
  @IsOptional()
  @IsString()
  voucherSerial?: string;

  @ApiPropertyOptional({ description: '카드 승인 번호', example: '12345678' })
  @IsOptional()
  @IsString()
  cardApprovalNo?: string;

  /**
   * 🔴 카드사·할부개월 — 수납 화면이 개통 이래 보내고 있었는데 **이 DTO 에 자리가 없어**
   *    전역 whitelist 가 지웠다. 200 + "수납이 완료되었습니다" + 값 소실.
   *    카드 매출 대사는 승인번호만으로 되지 않는다(어느 카드사 전표인지 모른다).
   */
  @ApiPropertyOptional({ description: '카드사(매입사) — 정산 대사용', example: '신한' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cardCompany?: string;

  @ApiPropertyOptional({ description: '할부 개월(0/1 = 일시불)', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  installment?: number;

  @ApiPropertyOptional({ description: '현금영수증 유형', example: 'INCOME', enum: ['INCOME', 'EXPENSE'] })
  @IsOptional()
  @IsString()
  cashReceiptType?: string;

  @ApiPropertyOptional({ description: '현금영수증 번호' })
  @IsOptional()
  @IsString()
  cashReceiptNo?: string;

  @ApiPropertyOptional({ description: '감면액 (원) — 본인부담금에서 차감', example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ description: '감면 사유', example: '직원가족 감면' })
  @IsOptional()
  @IsString()
  discountReason?: string;
}
