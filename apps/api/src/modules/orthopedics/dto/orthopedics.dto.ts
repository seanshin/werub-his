import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrthopedicsExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ description: '부위' })
  @IsString()
  bodyPart: string;

  @ApiPropertyOptional() @IsOptional() @IsString() side?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;
  @ApiPropertyOptional() @IsOptional() rom?: unknown;
  @ApiPropertyOptional() @IsOptional() mmt?: unknown;
  @ApiPropertyOptional() @IsOptional() specialTests?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() imagingFindings?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fractureClass?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() painVas?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() painLocation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() painPattern?: string;
}
