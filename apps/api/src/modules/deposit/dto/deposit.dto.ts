import { IsUUID, IsInt, IsString, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepositDto {
  @ApiProperty({ description: '환자 ID', example: 'uuid' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '예치금 금액 (원)', example: 500000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ description: '예치금 유형 (ADMISSION, SURGERY, GENERAL)', example: 'ADMISSION' })
  @IsString()
  depositType: string;

  @ApiPropertyOptional({ description: '결제 수단 (CASH, CARD, TRANSFER)', example: 'CARD' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: '입원 ID' })
  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  note?: string;
}
