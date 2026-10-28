import { IsUUID, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActivatePathwayDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() visitId?: string;
  @ApiProperty({ enum: ['STEMI', 'STROKE', 'SEPSIS'] }) @IsIn(['STEMI', 'STROKE', 'SEPSIS']) pathwayType: string;
}

export class CompleteMilestoneDto {
  @ApiProperty({ description: '마일스톤 key' }) @IsString() @Length(1, 40) key: string;
}

export class CancelPathwayDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 300) reason?: string;
}
