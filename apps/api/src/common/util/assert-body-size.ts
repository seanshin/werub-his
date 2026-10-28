import { BadRequestException } from '@nestjs/common';

/**
 * AI 프록시 raw body(Record<string, unknown>) 입력 크기 가드.
 * DTO whitelist strip 파급 없이(필드 다양성 유지) 폭주 입력만 차단 — 직렬화 길이 기준(기본 100KB).
 * 이미지 base64 등 대용량이 정당한 EP는 maxChars 를 넉넉히 지정.
 */
export function assertBodySize(body: unknown, maxChars = 100_000): void {
  let size = 0;
  try {
    size = JSON.stringify(body)?.length ?? 0;
  } catch {
    return; // 직렬화 불가(순환 등) — 가드 대상 아님(기존 흐름 유지)
  }
  if (size > maxChars) {
    throw new BadRequestException('요청이 너무 큽니다');
  }
}
