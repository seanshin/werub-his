import { IsString, IsUUID, IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateCareTeamDto {
  @ApiProperty({ description: '담당 의사 ID' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ description: '담당 간호사 ID' })
  @IsUUID()
  nurseId: string;

  @ApiProperty({ description: '진료과명' })
  @IsString()
  departmentName: string;

  @ApiPropertyOptional({ description: '팀 유형', default: 'OUTPATIENT' })
  @IsOptional()
  @IsString()
  teamType?: string;

  @ApiPropertyOptional({ description: '주 담당 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ description: '시작일' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: '종료일' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class UpdateCareTeamDto extends PartialType(CreateCareTeamDto) {
  @ApiPropertyOptional({ description: '활성화 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
