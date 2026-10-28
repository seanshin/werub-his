import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 범용 오더 결과 기록(치료·간호·활동·식이) — 정정은 amends 로 원래 기록을 가리킨 새 항목 */
export class RecordOrderResultDto {
  @ApiProperty({ description: '결과 요약(필수)' })
  @IsString() @MinLength(1) @MaxLength(2000)
  summary!: string;

  @ApiPropertyOptional({ description: '소견·세부' })
  @IsOptional() @IsString() @MaxLength(8000)
  findings?: string;

  @ApiPropertyOptional({ description: '실제 시행 시각(ISO) — 비우면 기록 시각만 남는다. 미래·오더 이전 불가' })
  @IsOptional() @IsDateString()
  performedAt?: string;

  @ApiPropertyOptional({ description: '기록과 함께 완료 처리' })
  @IsOptional() @IsBoolean()
  complete?: boolean;

  @ApiPropertyOptional({ description: '정정 대상 기록 id — 있으면 AMENDMENT 로 덧붙인다(원래 기록은 지우지 않음)' })
  @IsOptional() @IsUUID()
  amends?: string;
}
