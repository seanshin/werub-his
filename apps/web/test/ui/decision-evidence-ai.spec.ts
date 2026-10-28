import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 결정 등록부 근거 문서 AI 판독 — 2026-08-28.
 *
 * 🔴 개원 축과 **같은 정본**을 부른다. 각자 구현하면 한쪽만 정직해진다
 *    (한쪽은 못 읽은 칸을 빈 문자열로 채우고, 한쪽은 안 채우는 식).
 */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODE = strip(readFileSync(join(process.cwd(), 'src/app/(main)/admin/decisions/page.tsx'), 'utf-8'));

describe('같은 정본을 쓴다', () => {
  it('서버 판독 EP 를 부르고, 어휘를 화면이 다시 만들지 않는다', () => {
    expect(CODE).toMatch(/attachments\/\$\{id\}\/extract/);
    expect(CODE).toContain('EVIDENCE_FIELD_LABEL');
    expect(CODE).toContain('extractedCount');
  });

  it('🔴 판독 3상태를 뭉개지 않는다', () => {
    expect(CODE).toMatch(/draft\.source === 'UNAVAILABLE'/);
    expect(CODE).toMatch(/extractedCount\(draft\.fields\) === 0/);
  });

  it('🔴 문서가 어디로 가는지 화면이 말한다', () => {
    expect(CODE).toMatch(/\{EVIDENCE_EGRESS_NOTICE\}/);
    expect(CODE).toContain('AI_ORIGIN_TEXT');
    expect(CODE).not.toContain('자동분석');
  });

  it('🔴 이 화면은 판독 결과를 칸에 담지 않는다 — 뜻이 다른 칸이다', () => {
    // 권한 근거·검토 참조는 문서에서 뽑은 번호와 뜻이 다르다. 담기 버튼을 두면
    // 사람이 읽지 않고 넣는다.
    expect(CODE).not.toContain('입력칸에 담기');
    expect(CODE).not.toContain('setAuthorityClaim(draft');
  });
});

describe('🔴 업로드가 정본 클라이언트를 통과한다', () => {
  it('raw fetch 를 쓰지 않는다 — 토큰 갱신·세션 만료를 못 탄다', () => {
    expect(CODE).toContain('apiClient.postForm');
    expect(CODE, '화면이 직접 fetch 하지 않는다').not.toMatch(/await fetch\(/);
    // Authorization 헤더를 손으로 붙이던 자리도 사라져야 한다
    expect(CODE).not.toMatch(/Authorization: `Bearer \$\{apiClient\.getToken\(\)\}`/);
  });
});
