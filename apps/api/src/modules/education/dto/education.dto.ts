import {
  IsString, IsNumber, IsOptional, IsBoolean, IsUUID, IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 교육 프로그램 등록 ──

export class CreateProgramDto {
  @ApiProperty({ description: '프로그램명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '분류' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: '필수 교육 여부' })
  @IsBoolean()
  isMandatory: boolean;

  @ApiPropertyOptional({ description: '유효기간 (개월)' })
  @IsOptional()
  @IsNumber()
  validMonths?: number;
}

// ── 교육 이수 기록 ──

export class RecordCompletionDto {
  @ApiProperty({ description: '프로그램 ID' })
  @IsUUID()
  programId: string;

  @ApiProperty({ description: '직원 ID' })
  @IsString()
  @IsNotEmpty()
  staffId: string;

  @ApiPropertyOptional({ description: '점수' })
  @IsOptional()
  @IsNumber()
  score?: number;
}
