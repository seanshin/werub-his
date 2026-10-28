import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MergePatientsDto {
  @ApiProperty({ description: 'Source 환자 ID (병합 후 비활성)' })
  @IsUUID()
  sourceId: string;

  @ApiProperty({ description: 'Target 환자 ID (병합 대상)' })
  @IsUUID()
  targetId: string;

  @ApiProperty({ description: '병합 사유' })
  @IsString()
  @MinLength(1)
  reason: string;

  /**
   * 원 환자에 옮겨지지 않는 기록이 있음을 확인했다(2026-10-20 P2) — 병합은 6개 모델만 옮긴다.
   * 남는 기록이 있는데 false/없음이면 409 MERGE_UNMOVED_RECORDS · 확인한 내용은 병합 이력에 남는다.
   */
  @ApiPropertyOptional({ description: '옮겨지지 않는 기록을 확인했다' })
  @IsOptional()
  @IsBoolean()
  acknowledgeUnmoved?: boolean;
}

/** 병합 미리보기 쿼리 */
export class MergePreviewQueryDto {
  @ApiProperty() @IsUUID() sourceId: string;
  @ApiProperty() @IsUUID() targetId: string;
}
