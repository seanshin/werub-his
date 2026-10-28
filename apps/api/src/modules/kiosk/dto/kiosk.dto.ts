import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class KioskCheckInDto {
  @ApiProperty({ description: '등록번호(MRN)' })
  @IsString() @IsNotEmpty()
  mrn: string;

  @ApiProperty({ description: '생년월일(YYYYMMDD 또는 YYMMDD)' })
  @IsString() @IsNotEmpty()
  dob: string;
}

export class KioskPayDto extends KioskCheckInDto {
  @ApiPropertyOptional({ description: '결제수단 CARD|SIMPLE' })
  @IsOptional() @IsIn(['CARD', 'SIMPLE'])
  method?: string;
}
