import { IsString, IsNumber, IsBoolean, IsOptional, IsUUID, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BurnRegionDto {
  @ApiProperty({ description: '화상 부위' })
  @IsString()
  region: string;

  @ApiProperty({ description: '면적 비율 (%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage: number;

  @ApiProperty({ description: '화상 깊이' })
  @IsString()
  depth: string;
}

export class CreateBurnAssessmentDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ description: 'TBSA (%) — 서버가 부위 합으로 재산정(정본)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tbsa?: number;

  @ApiProperty({ description: '화상 부위 목록', type: [BurnRegionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BurnRegionDto)
  regions: BurnRegionDto[];

  @ApiPropertyOptional({ description: '손상 기전' })
  @IsOptional()
  @IsString()
  mechanism?: string;

  @ApiPropertyOptional({ description: '소아 여부' })
  @IsOptional()
  @IsBoolean()
  isChild?: boolean;

  @ApiPropertyOptional({ description: '체중(kg) — Parkland 수액소생 계산 스냅샷' })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(500)
  weightKg?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CalculateParklandDto {
  @ApiPropertyOptional({ description: '환자 ID — 체중 미입력 시 최근 활력징후에서 자동 조회' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: '체중(kg)' })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(500)
  weightKg?: number;

  @ApiProperty({ description: 'TBSA (%)' })
  @IsNumber()
  @Min(0.1)
  @Max(100)
  tbsa: number;

  @ApiPropertyOptional({ description: '소아 여부(적응 기준·소변량 목표 분기)' })
  @IsOptional()
  @IsBoolean()
  isChild?: boolean;

  @ApiPropertyOptional({ description: '수상 후 경과시간(h) — 전반 8h분 압축 투여 계산' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  hoursSinceBurn?: number;
}

export class CalculateTbsaDto {
  @ApiProperty({ description: '화상 부위 목록', type: [BurnRegionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BurnRegionDto)
  regions: BurnRegionDto[];

  @ApiProperty({ description: '소아 여부' })
  @IsBoolean()
  isChild: boolean;
}
