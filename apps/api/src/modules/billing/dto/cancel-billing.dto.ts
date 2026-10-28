import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelBillingDto {
  @ApiProperty({ description: '취소 사유', example: '환자 요청' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
