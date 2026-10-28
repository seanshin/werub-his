import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 가드 — 간호기록·동의서 AI 초안 화면이 **제안 원장과 실제로 이어져 있는가**(정적 대조).
 * 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1 · P1-③.
 *
 * 왜 정적 대조인가: 여기서 지켜야 할 것은 렌더 결과가 아니라 **호출의 존재와 자리**다.
 *  · 노출(PRESENTED)은 "생성됐다"가 아니라 "화면이 그렸다" 일 때만 보고해야 한다(서버가 그 차이를 지표로 쓴다).
 *  · 결정(ACCEPTED/EDITED)은 사람이 그 본문으로 정본을 만든 순간에만 남아야 한다 —
 *    초안이 폼에 꽂히는 순간 ACCEPTED 를 찍으면 "읽기도 전에 수락"이 원장에 남는다(P16).
 *  · 초안 본문을 잇는 규칙이 FE↔서버에서 갈라지면 수정량이 사람이 고치지 않은 만큼 부풀려진다(P11).
 *
 * 🔴 각 항목은 **결함을 재주입하면 실패한다** — 호출을 지우거나, 결정 시점을 옮기거나,
 *    구분자/순서를 바꾸면 아래 대조가 깨진다.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const PANEL = 'src/components/ai/NursingAiDraftPanel.tsx';
const CONSENT_PAGE = 'src/app/(main)/workstation/consent/page.tsx';
const CONSENT_SERVICE = '../api/src/modules/consent/consent.service.ts';

describe('간호 초안 패널 — 노출 보고', () => {
  const src = read(PANEL);

  it('제안 헬퍼 정본(`@/lib/ai-proposal`)에서 markProposalPresented 를 가져온다', () => {
    expect(src).toMatch(/import\s*\{[^}]*markProposalPresented[^}]*\}\s*from\s*'@\/lib\/ai-proposal'/);
  });

  it('🔴 노출 보고는 초안이 실제로 그려진 뒤(useEffect · state==="ready")에만', () => {
    const effect = src.slice(src.indexOf('useEffect('), src.indexOf('const generate'));
    expect(effect).toContain("state !== 'ready'");
    expect(effect).toContain("markProposalPresented(id, 'nursing-ai-draft')");
    // 생성 요청(generate) 안에서 부르면 "만들자마자 봤다"가 된다
    const generate = src.slice(src.indexOf('const generate'), src.indexOf('const apply'));
    expect(generate).not.toContain('markProposalPresented');
  });

  it('제안 id 는 스냅샷에서 읽고, 없으면 보고하지 않는다(지어내지 않는다)', () => {
    expect(src).toContain('aiProposalId');
    expect(src).toMatch(/typeof id !== 'string'/);
  });

  it('같은 제안을 두 번 보고하지 않는다(리렌더 방어)', () => {
    expect(src).toContain('presentedRef');
    expect(src).toMatch(/presentedRef\.current === id/);
  });
});

describe('동의서 워크스테이션 — 노출과 결정의 자리', () => {
  const src = read(CONSENT_PAGE);
  const aiSuccess = src.slice(src.indexOf('const aiMut'), src.indexOf('const patients ='));
  const createAt = src.indexOf('const createMut', src.indexOf('const aiMut'));
  const createSuccess = src.slice(createAt, src.indexOf('return (', createAt));

  it('제안 헬퍼 정본에서 proposalIdFrom·markProposalPresented 를 가져온다', () => {
    expect(src).toMatch(/import\s*\{[^}]*proposalIdFrom[^}]*markProposalPresented[^}]*\}\s*from\s*'@\/lib\/ai-proposal'/);
  });

  it('노출 보고는 초안이 폼에 그려지는 자리에서 1회', () => {
    expect(aiSuccess).toContain('proposalIdFrom(res?.data)');
    expect(aiSuccess).toContain('markProposalPresented(pid');
    expect(aiSuccess).toContain('presentedRef.current !== pid');
  });

  it('🔴 초안이 꽂히는 순간에는 결정을 남기지 않는다 — 그 자리의 recordDraftApplied 에 proposalId 가 없다', () => {
    const call = aiSuccess.slice(aiSuccess.indexOf('recordDraftApplied({'));
    const oneCall = call.slice(0, call.indexOf('})') + 2);
    expect(oneCall).not.toContain('proposalId');
    expect(oneCall).not.toContain('decision');
    expect(oneCall).not.toContain('finalText');
  });

  it('🔴 결정은 동의서가 실제로 만들어진 뒤(createMut onSuccess)에 최종본과 함께', () => {
    expect(createSuccess).toContain('proposalId: aiProposalId');
    expect(createSuccess).toContain('finalText');
    expect(createSuccess).toContain("decision: aiDraftText != null && finalText === aiDraftText ? 'ACCEPTED' : 'EDITED'");
    expect(createSuccess).toContain('consentDraftText(form)');
  });

  it('제안 id 가 없으면 결정도 없다(있는 척하지 않는다)', () => {
    expect(createSuccess).toMatch(/if\s*\(aiProposalId\)/);
  });

  it('어느 동의서가 됐는지는 clientContext 로 남긴다(생성 시점엔 대상 행이 없었다)', () => {
    expect(createSuccess).toContain('consent-form:${createdId}');
  });
});

describe('🔴 초안 본문 잇는 규칙 — FE↔서버 한 벌', () => {
  const fe = read(CONSENT_PAGE);
  const be = readFileSync(join(root, CONSENT_SERVICE), 'utf8');
  const body = (src: string) => {
    const at = src.indexOf('function consentDraftText');
    return src.slice(at, src.indexOf('}', src.indexOf('return', at)));
  };

  it('두 정의의 본문이 문자 그대로 같다(순서·구분자·빈 항목 처리)', () => {
    const feBody = body(fe).replace(/\s+/g, ' ');
    const beBody = body(be).replace(/\s+/g, ' ');
    expect(feBody).toContain("[s.risks ?? '', s.alternatives ?? '', s.explanation ?? ''].join('\\n\\n')");
    expect(feBody).toBe(beBody);
  });

  it('page.tsx 는 이 함수를 export 하지 않는다(Next 가 허용하지 않는 export = 빌드 실패)', () => {
    expect(fe).not.toMatch(/export\s+function\s+consentDraftText/);
    expect(fe).toMatch(/^function consentDraftText/m);
  });
});
