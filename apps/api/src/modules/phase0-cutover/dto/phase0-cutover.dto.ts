import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * (2026-09-15 B10) 가명화 컷오버 법무/CPO 승인 — 인라인 본문이었다.
 *  - `reason` 이 문자열이 아니면 서비스의 `.trim()` 이 TypeError 500 이었다.
 *  - `checklist` 는 **본문 객체를 통째로** 승인 원장(SystemConfig `integration.cutoverApproval`)에 저장했다 —
 *    체크리스트 정본 키 밖의 임의 키·값이 승인 기록에 섞였다. 저장은 서비스가 정본 6키의 `=== true` 만 남긴다.
 * 필수 여부(사유·전항 확인)는 서비스 규칙 그대로 — 그 400 문구가 사용자에게 무엇이 빠졌는지 말한다.
 */
export class ApproveCutoverDto {
  @ApiPropertyOptional({ description: '승인 근거(서비스가 필수로 검사)' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: '체크리스트 키 → 확인 여부' })
  @IsOptional()
  @IsObject()
  checklist?: Record<string, boolean>;
}
