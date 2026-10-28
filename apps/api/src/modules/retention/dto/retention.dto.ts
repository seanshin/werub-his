import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpsertPolicyDto {
  @ApiProperty({ description: '리소스 유형' })
  @IsString()
  @Length(1, 40)
  resourceType!: string;

  @ApiProperty({ description: '보존 후 파기 기준일' })
  @IsInt()
  @Min(0)
  retentionDays!: number;

  @ApiPropertyOptional({ description: '법정 최소 보존(클램프)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  legalMinDays?: number;

  @ApiPropertyOptional({ enum: ['REPORT_ONLY', 'SOFT_DELETE', 'ANONYMIZE', 'HARD_PURGE'] })
  @IsOptional()
  @IsIn(['REPORT_ONLY', 'SOFT_DELETE', 'ANONYMIZE', 'HARD_PURGE'])
  action?: string;

  @ApiPropertyOptional({ description: '법무 보존기간 확정' })
  @IsOptional()
  @IsBoolean()
  legalConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;
}

export class PurgeDto {
  @ApiProperty({ description: '파기 대상 resourceType' })
  @IsString()
  @Length(1, 40)
  resourceType!: string;

  @ApiProperty({ description: '명시적 확인(true 필수)' })
  @IsBoolean()
  confirm!: boolean;

  @ApiPropertyOptional({ description: '사유(파기 요청 시)' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  reason?: string;
}
