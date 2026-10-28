import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** 검사결과 확인함 한 번에 돌려주는 최대 건수 — 넘으면 화면이 "N건 중 M건"으로 말한다 */
export const RESULTS_INBOX_MAX_LIMIT = 100;
export const RESULTS_INBOX_DEFAULT_LIMIT = 50;

/**
 * 검사결과 확인함 조회 — 기본은 **내 오더**(`myOrdersPrescriptionWhere`),
 * `patientId` 를 주면 **그 환자의 미확인 결과 전부**(담당 센서스의 "미확인 검사 N건"과 같은 정의).
 */
export class ResultsInboxQueryDto {
  @ApiPropertyOptional({ description: '지정하면 이 환자의 미확인 결과 전부(처방의 무관) — 센서스 "미확인 검사" 드릴다운' })
  @IsOptional() @IsUUID() patientId?: string;

  @ApiPropertyOptional({ description: '한 번에 돌려줄 건수(1~100·기본 50)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(RESULTS_INBOX_MAX_LIMIT) limit?: number;

  @ApiPropertyOptional({ description: '건너뛸 건수(더 보기)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

/** 결과 일괄 확인 — 한 번에 최대 100건. 결과가 없거나 이미 확인된 오더는 건너뛰고 그 수를 돌려준다 */
export class BulkAcknowledgeOrdersDto {
  @ApiProperty({ type: [String], description: '확인할 오더 id(최대 100)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(RESULTS_INBOX_MAX_LIMIT) @IsUUID('all', { each: true })
  orderIds: string[];
}
