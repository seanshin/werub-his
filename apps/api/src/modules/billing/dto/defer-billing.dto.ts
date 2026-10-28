import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeferBillingDto {
  @ApiProperty({ description: '보류 사유', example: '보험 확인 필요' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
