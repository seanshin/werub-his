import { IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CheckDuplicateDto {
  @ApiPropertyOptional({ example: '홍' })
  @IsOptional()
  @IsString()
  familyName?: string;

  @ApiPropertyOptional({ example: '길동' })
  @IsOptional()
  @IsString()
  givenName?: string;

  @ApiPropertyOptional({ example: '1990-01-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '010-1234-5678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '주민등록번호' })
  @IsOptional()
  @IsString()
  nationalId?: string;
}
