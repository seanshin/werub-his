import { IsString, IsNumber, IsBoolean, IsOptional, IsUUID, IsIn, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNeurosurgeryExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() gcsEye?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() gcsVerbal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() gcsMotor?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() gcsTotal?: number;
  @ApiPropertyOptional() @IsOptional() pupilRight?: unknown;
  @ApiPropertyOptional() @IsOptional() pupilLeft?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() anisocoria?: boolean;
  @ApiPropertyOptional() @IsOptional() motorExam?: unknown;
  @ApiPropertyOptional() @IsOptional() sensoryExam?: unknown;
  @ApiPropertyOptional() @IsOptional() reflexes?: unknown;
  @ApiPropertyOptional() @IsOptional() babinski?: unknown;
  @ApiPropertyOptional() @IsOptional() cranialNerves?: unknown;
  /** ASIA 손상 척도 A~E — 🔴 종전 아무 문자열이나 받았다(2026-10-10) */
  @ApiPropertyOptional({ enum: ['A', 'B', 'C', 'D', 'E'] }) @IsOptional() @IsIn(['A', 'B', 'C', 'D', 'E']) asiaScale?: string;
  /** NIHSS 0~42 정수 — 🔴 종전 아무 숫자나(음수·소수) 받았다 */
  @ApiPropertyOptional({ minimum: 0, maximum: 42 }) @IsOptional() @IsInt() @Min(0) @Max(42) nihss?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;
}
