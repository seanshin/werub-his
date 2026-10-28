/**
 * 처방전 인쇄 — 발급 원장·진위 확인 · 거짓 "전자처방전" 문구 제거(2026-09-30).
 *  🔴 종전: "이 처방전은 전자처방전입니다 · 하단 QR로 검증하십시오"(QR 없음·전송 없음) · 교부번호 RX-… 는 계산만(기록 없음)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src/app/(main)/print/prescription/[encounterId]/page.tsx'), 'utf8');
const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('처방전 인쇄', () => {
  it('거짓 문구·계산한 교부번호가 코드에 남아 있지 않다', () => {
    expect(code).not.toContain('이 처방전은 전자처방전입니다');
    expect(code).not.toMatch(/`RX-\$\{format/);
  });
  it('발급 EP 를 부르고(서명 전에는 부르지 않는다) 교부번호·QR·미전송 사실을 발급 응답에서 그린다', () => {
    expect(code).toMatch(/\/api\/v1\/encounters\/\$\{encounterId\}\/prescription-issue/);
    expect(code).toMatch(/enabled: !!data\?\.data && data\.data\.status !== 'DRAFT'/);
    expect(code).toContain("issueQ.isError ? '발급 기록 실패 — 교부번호 없음'");
    expect(code).toMatch(/!issueQ\.data\.transmission\.transmitted && <p data-rx-not-transmitted>/);
    expect(code).toMatch(/issueQ\.data\.qrDataUrl && <img/);
  });
});
