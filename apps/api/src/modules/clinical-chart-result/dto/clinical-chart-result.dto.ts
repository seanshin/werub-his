import { IsString, IsOptional, IsNotEmpty, IsUUID, IsObject, IsNumber, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClinicalChartResultDto {
  @ApiProperty() @IsUUID() patientId: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() encounterId?: string;

  @ApiProperty({ description: '임상차트 ID (예: NEWS2)' }) @IsString() @IsNotEmpty() chartId: string;

  @ApiProperty() @IsString() @IsNotEmpty() chartName: string;

  @ApiProperty({ description: 'scoring|lookup|formula' }) @IsString() @IsNotEmpty() archetype: string;

  @ApiPropertyOptional() @IsOptional() @IsString() sourceVersion?: string;

  @ApiProperty({ description: '입력값(아키타입별 JSON)' }) @IsObject() inputs: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) resultLabel?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) resultLevel?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() resultValue?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) recommendation?: string;

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true }) flags?: string[];
}
