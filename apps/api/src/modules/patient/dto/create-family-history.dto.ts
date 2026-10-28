import { IsString, IsOptional, IsUUID, IsBoolean, IsInt, Min, Max, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFamilyHistoryDto {
  @ApiProperty({ description: '관계', enum: ['FATHER', 'MOTHER', 'SIBLING', 'GRANDFATHER', 'GRANDMOTHER', 'CHILD', 'OTHER'] })
  @IsString()
  @IsIn(['FATHER', 'MOTHER', 'SIBLING', 'GRANDFATHER', 'GRANDMOTHER', 'CHILD', 'OTHER'])
  relation!: string;

  @ApiProperty({ description: '질환명' })
  @IsString()
  conditionName!: string;

  @ApiPropertyOptional({ description: 'KCD 진단코드 ID(선택)' })
  @IsOptional()
  @IsUUID()
  diagnosisCodeId?: string;

  @ApiPropertyOptional({ description: '발병 연령' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  onsetAge?: number;

  @ApiPropertyOptional({ description: '사망 여부' })
  @IsOptional()
  @IsBoolean()
  isDeceased?: boolean;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  note?: string;
}
