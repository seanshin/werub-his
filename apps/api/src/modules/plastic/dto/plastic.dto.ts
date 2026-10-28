import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlasticExamDto {
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

  @ApiProperty({ description: '시술/수술명' })
  @IsString()
  procedure: string;

  @ApiPropertyOptional() @IsOptional() @IsString() anesthesiaType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() material?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fitzpatrickType?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() skinElasticity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scarTendency?: string;
  @ApiPropertyOptional() @IsOptional() photoAngles?: unknown;
  @ApiPropertyOptional() @IsOptional() beforePhotoUrls?: unknown;
  @ApiPropertyOptional() @IsOptional() afterPhotoUrls?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() complications?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;
}
