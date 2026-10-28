import { IsString, IsOptional, IsArray, IsUUID, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CopyFromEncounterDto {
  @ApiProperty({ description: '원본 진료 ID' })
  @IsUUID()
  sourceEncounterId: string;

  @ApiPropertyOptional({ description: '복사할 처방 ID 목록 (없으면 전체)' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  prescriptionIds?: string[];

  @ApiPropertyOptional({ description: 'DUR ERROR 강제 통과(사유 필수·감사 기록)' })
  @IsOptional()
  @IsBoolean()
  overrideDur?: boolean;

  @ApiPropertyOptional({ description: 'DUR 강제 통과 사유' })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}

export class CopyPrescriptionsDto {
  @ApiProperty({ description: '원본 진료 ID' })
  @IsUUID()
  sourceEncounterId: string;

  @ApiProperty({ description: '대상 진료 ID' })
  @IsUUID()
  targetEncounterId: string;

  @ApiPropertyOptional({ description: '처방 타입 필터' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  types?: string[];

  @ApiPropertyOptional({ description: 'DUR ERROR 강제 통과(사유 필수·감사 기록)' })
  @IsOptional()
  @IsBoolean()
  overrideDur?: boolean;

  @ApiPropertyOptional({ description: 'DUR 강제 통과 사유' })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}

export class RepeatPrescriptionDto {
  @ApiPropertyOptional({ description: 'DUR ERROR 강제 통과(사유 필수·감사 기록)' })
  @IsOptional()
  @IsBoolean()
  overrideDur?: boolean;

  @ApiPropertyOptional({ description: 'DUR 강제 통과 사유' })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}
