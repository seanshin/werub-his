import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * 🔴 (2026-09-15 B10) 빈 임시저장 진료기록 정리 — 인라인 본문이었다.
 *  - `cutoffHours: "abc"` → `NaN` 시각으로 Prisma 500 · `0`·음수 → 기준 시각이 **지금 이후**가 되어
 *    방금 연(아직 아무것도 안 쓴) 초안까지 `confirm` 삭제 대상이 됐다. 최소 1시간(기본 24시간은 서비스 그대로).
 *  - `confirm` 은 서비스가 `=== true` 로만 삭제하므로 문자열 "true" 는 원래도 삭제하지 않았다 — 불리언이 아닌 값은 이제 400.
 */
export class PurgeEmptyDraftsDto {
  @ApiPropertyOptional({ description: '무시됨(삭제는 confirm=true 일 때만)' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: 'true 일 때만 실제 삭제' })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @ApiPropertyOptional({ description: '마지막 수정 후 경과 시간(시간) — 기본 24', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  cutoffHours?: number;
}
