import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RefundBillingDto {
  @ApiProperty({ description: '환불 금액 (원)', example: 15000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ description: '환불 사유', example: '중복 결제' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
