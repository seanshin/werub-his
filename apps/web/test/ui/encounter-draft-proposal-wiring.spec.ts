/**
 * AI 초안 3화면 ↔ 제안 원장(`AiProposal`) 배선 가드 — 기획서 §2.1 · P1-②
 *
 * 무엇을 막는가(정적 검사인 이유는 이 결함이 **호출이 아예 없는 것**이라서다 — 렌더 테스트로는 "안 부르는 것"을 못 본다)
 *  · 서버가 제안을 만들었는데 화면이 **노출(PRESENTED)을 보고하지 않는 것** → 감독 화면의 검토시간이 통째로 거짓이 된다.
 *  · 적용(수락)을 감사 원장에만 남기고 **제안 원장에는 남기지 않는 것** → 수용/수정/거부 비율이 0 이 된다.
 *  · `finalText` 를 빼먹는 것 → 편집거리가 `null`(미측정)로만 남아 "무수정 승인"을 셀 수 없다.
 *
 * 🔴 대조군을 함께 둔다 — 이 파일의 검사가 "아무 파일에서나 통과"하지 않는지(가드가 다른 이유로 통과하는 사고 방지).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WEB_SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p: string[]) => fs.readFileSync(path.join(WEB_SRC, ...p), 'utf8');

const PANEL = read('app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components', 'AiAssistantPanel.tsx');
const ENCOUNTER_PAGE = read('app', '(main)', 'patients', '[id]', 'encounter', 'new', 'page.tsx');
const WS_DISCHARGE = read('app', '(main)', 'workstation', 'discharge', 'page.tsx');
const INPATIENT_DISCHARGE = read('app', '(main)', 'inpatient', '[admissionId]', 'discharge-summary', 'page.tsx');
const HELPER = read('lib', 'ai-proposal.ts');
const BANNER = read('components', 'ai', 'DraftBanner.tsx');

/** 대조군 — 제안 원장과 무관한 화면. 아래 검사들이 여기서 통과하면 검사가 아무것도 겨누지 않는 것이다. */
const CONTROL = read('app', '(main)', 'workstation', 'discharge', 'page.tsx').length > 0
  ? read('components', 'ui', 'QueryErrorFallback.tsx')
  : '';

describe('SOAP 초안(진료 신규) — 노출·결정을 제안 원장에 보고한다', () => {
  it('🔴 초안이 실제로 그려질 때만 노출을 보고한다(펼침+SOAP 탭 조건) · 제안당 1회', () => {
    expect(PANEL).toMatch(/markProposalPresented\(pid, 'encounter-new'\)/);
    // "만들어졌다"가 아니라 "그려진다"가 조건이다 — collapsed·activeTab 을 함께 본다
    expect(PANEL).toMatch(/if \(!pid \|\| collapsed \|\| activeTab !== 'soap'\) return;/);
    expect(PANEL).toMatch(/soapPresentedRef/);
  });

  it('서버가 실은 proposalId 를 초안에 붙여 들고 다닌다(지어내지 않는다 — 없으면 null)', () => {
    expect(PANEL).toMatch(/proposalIdFrom\(data\)/);
    expect(PANEL).toMatch(/proposalId\?: string \| null;/);
    // 재진입 진료면 대상(encounterId)을 함께 보낸다
    expect(PANEL).toMatch(/\.\.\.\(encounterId \? \{ encounterId \} : \{\}\)/);
  });

  it('🔴 적용 버튼이 proposalId 를 부모에게 넘긴다 — 부모가 결정을 원장에 남길 수 있어야 한다', () => {
    expect(PANEL).toMatch(/onApplySoap\?\.\([\s\S]{0,200}\{ proposalId: soapDraft\.proposalId \?\? null \}\)/);
  });

  it("🔴 '무시'는 명시적 거부(REJECTED)로 남는다 — 만료와 섞이면 거부율이 거짓이 된다", () => {
    expect(PANEL).toMatch(/decideProposal\(pid, \{ decision: 'REJECTED'/);
  });

  it('🔴 진료 화면이 recordDraftApplied 에 proposalId·decision·finalText 를 넘긴다', () => {
    expect(ENCOUNTER_PAGE).toMatch(/proposalId: proposal\.proposalId, decision: 'ACCEPTED' as const/);
    expect(ENCOUNTER_PAGE).toMatch(/finalText: proposal\.finalText/);
    // finalText 직렬화는 서버 serializeSoapDraft 와 같은 규칙(A\nP · 빈 칸 제거)이어야 편집거리가 사실이 된다
    expect(ENCOUNTER_PAGE).toMatch(/\[assessment, plan\]\.filter\(\(s\) => s && s\.trim\(\)\)\.join\('\\n'\)/);
  });
});

describe('퇴원요약 초안 2화면 — 노출·결정을 제안 원장에 보고한다', () => {
  const SCREENS: Array<[string, string, string]> = [
    ['워크스테이션 퇴원', WS_DISCHARGE, 'workstation-discharge'],
    ['입원 퇴원요약', INPATIENT_DISCHARGE, 'inpatient-discharge-summary'],
  ];

  for (const [name, src, ctx] of SCREENS) {
    it(`${name}: proposalId 를 응답에서 읽고 · 노출을 먼저 보고하고 · 결정에 finalText 를 싣는다`, () => {
      expect(src, `${name}: proposalIdFrom 미사용`).toMatch(/proposalIdFrom\(/);
      expect(src, `${name}: markProposalPresented 미호출`).toMatch(new RegExp(`markProposalPresented\\(proposalId, '${ctx}'\\)`));
      expect(src, `${name}: decision/finalText 누락`).toMatch(/decision: 'ACCEPTED' as const, finalText: (result|text)/);
      // 🔴 순서 — 노출 보고가 결정 보고보다 앞에 있어야 원장이 NOT_PRESENTED 로 남지 않는다
      expect(src.indexOf('markProposalPresented'), `${name}: 노출 보고가 결정보다 뒤에 있다`).toBeLessThan(src.indexOf("decision: 'ACCEPTED'"));
    });

    it(`${name}: 제안 대상(admissionId)을 craft 요청에 실어 보낸다 — 서버가 대상을 추정하지 않게`, () => {
      expect(src).toMatch(/style: 'medical_discharge',\s*\n\s*(\/\/[^\n]*\n\s*)?admissionId/);
    });

    it(`${name}: proposalId 가 없으면 아무것도 보고하지 않는다(있는 척하지 않는다)`, () => {
      expect(src).toMatch(/\.\.\.\(proposalId \? \{ proposalId/);
    });
  }
});

describe('정본 헬퍼 — 화면이 쓰는 것과 만든 것이 같다', () => {
  it('FE 헬퍼가 세 가지를 제공한다(proposalIdFrom · markProposalPresented · decideProposal)', () => {
    expect(HELPER).toMatch(/export function proposalIdFrom/);
    expect(HELPER).toMatch(/export async function markProposalPresented/);
    expect(HELPER).toMatch(/export async function decideProposal/);
  });

  it('DraftBanner 가 proposalId 를 받으면 결정을 제안 원장에도 남긴다(감사 원장과 함께)', () => {
    expect(BANNER).toMatch(/if \(input\.proposalId\)/);
    expect(BANNER).toMatch(/decideProposal\(input\.proposalId/);
  });

  it('🔴 대조군: 제안과 무관한 컴포넌트에는 이 배선이 없다(검사가 아무 파일에서나 통과하지 않는다)', () => {
    expect(CONTROL.length).toBeGreaterThan(0);
    expect(CONTROL).not.toMatch(/markProposalPresented/);
    expect(CONTROL).not.toMatch(/proposalIdFrom/);
  });

  it('🔴 대조군: 신뢰도 상수를 화면이 지어내지 않는다(R7 재발 방지 — 이 축의 이웃 규칙)', () => {
    expect(PANEL).not.toMatch(/confidence: 0\.\d/);
  });
});
