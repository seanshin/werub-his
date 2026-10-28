import { IsString, IsNumber, IsOptional, IsUUID, IsIn, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateObGynExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ description: '검사 유형' })
  @IsIn(['PRENATAL', 'GYNECOLOGY', 'LABOR', 'POSTPARTUM'])
  examType: 'PRENATAL' | 'GYNECOLOGY' | 'LABOR' | 'POSTPARTUM';

  @ApiPropertyOptional() @IsOptional() @IsString() gestationalAge?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() edd?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(30) gravida?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(30) para?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(20) @Max(300) prePregnancyWeight?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(20) @Max(300) currentWeight?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() bloodPressure?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() urineProtein?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() urineGlucose?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() edema?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(60) fundalHeight?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(300) fetalHeartRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() fetalMovement?: string;
  @ApiPropertyOptional() @IsOptional() ultrasound?: unknown;
  @ApiPropertyOptional() @IsOptional() nst?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(10) cervicalDilation?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) effacement?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-5) @Max(5) station?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() papSmear?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hpvTest?: string;
  @ApiPropertyOptional() @IsOptional() pelvicUltrasound?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;
}
