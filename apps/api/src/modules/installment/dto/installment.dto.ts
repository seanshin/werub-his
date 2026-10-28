import { IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInstallmentDto {
  @ApiProperty({ description: '분할 횟수 (2~12회)', example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(12)
  installments: number;
}
