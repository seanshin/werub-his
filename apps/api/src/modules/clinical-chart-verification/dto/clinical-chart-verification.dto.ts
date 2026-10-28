import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChartVerificationDto {
  @ApiProperty({ description: '임상차트 ID (예: NEWS2)' })
  @IsString()
  @IsNotEmpty()
  chartId: string;

  @ApiProperty({ description: 'VERIFIED(검증 승인) | REJECTED(반려)' })
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @ApiPropertyOptional({ description: '대조한 공식 가이드라인' })
  @IsOptional()
  @IsString()
  sourceGuideline?: string;

  @ApiPropertyOptional({ description: '대조한 원문 버전' })
  @IsOptional()
  @IsString()
  sourceVersion?: string;

  @ApiPropertyOptional({ description: '검수 소견(대조 결과·수정 요구 등)' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: '승인 시점 정의 해시(FE 계산) — 정의 변경 시 재검수 무효화' })
  @IsOptional()
  @IsString()
  defHash?: string;
}
