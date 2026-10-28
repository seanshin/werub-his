import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 R3 — AI 임상 기능 스위치 6개가 **켜진 채 운영되는데 근거가 없었다**(2026-08-28 실측).
 *    화면은 그것을 정책처럼 보여줬다. 이제 ON 인 스위치 옆에 결정 등록부
 *    `policy.ai.clinicalFeatureScope` 의 기록 유무를 말한다.
 *
 * 🔴 **조회 실패·항목 부재는 "기록 없음"이 아니다.** 로딩/확인 불가/기록 없음/기록됨은 다른 사실이다.
 *
 * 🔴 이 가드가 태어난 이유: 처음 구현이 응답을 **배열로 가정**했다. 실제 계약은
 *    `{ data: { items: [...] } }` 라, 조회가 성공해도 화면은 영원히 "확인 불가"를 그렸을 것이다
 *    (P11 — FE↔서버 계약 불일치). 그래서 **양쪽을 함께** 본다.
 */
const PAGE = join(process.cwd(), 'src/app/(main)/admin/ai-settings/page.tsx');
const DECISION_SERVICE = join(process.cwd(), '../api/src/modules/decision-registry/decision.service.ts');
const DECISION_REGISTRY = join(process.cwd(), '../api/src/modules/decision-registry/decision.registry.ts');

const page = readFileSync(PAGE, 'utf8');

describe('🔴 AI 임상 기능 ON 옆에 결정 기록을 말한다', () => {
  it('실측된 6개 스위치를 전부 대상으로 삼는다', () => {
    for (const k of [
      'ai.server.enabled', 'scribe.enabled', 'voiceEmr.enabled',
      'voiceEmr.ambient.enabled', 'voiceEmr.ambient.aiDraft.enabled', 'nursing.aiAssist.enabled',
    ]) {
      expect(page, `${k} 가 대상에서 빠졌다`).toContain(`'${k}'`);
    }
  });

  it('🔴 저장된 값이 ON 일 때만 붙인다 — 편집 중인 값으로 판정하지 않는다', () => {
    expect(page).toMatch(/config\.value === true && \(\s*<ClinicalDecisionBadge/);
  });

  it('🔴 네 상태를 구분한다(로딩·확인 불가·기록 없음·기록됨)', () => {
    expect(page).toContain('결정 기록 확인 중…');
    expect(page).toContain('켜져 있음 · 결정 기록 확인 불가');
    expect(page).toContain('켜져 있음 · 결정 기록 없음');
    expect(page).toMatch(/결정 \{AI_CLINICAL_DECISION_KEY\} 기록됨/);
  });

  it('🔴 조회 실패를 기본값으로 접지 않는다 — catch 는 "확인 불가"로만 간다', () => {
    expect(page).toMatch(/\.catch\(\(e: \{ message\?: string \}\) => \{[\s\S]{0,200}phase: 'unavailable'/);
    // 등록부에 항목이 없는 것도 "기록 없음"이 아니다
    expect(page).toMatch(/if \(!row\) \{ setDecisionState\(\{ phase: 'unavailable'/);
  });

  it('🔴 서버 계약대로 items 를 읽는다 — 배열로 가정하면 성공이 "확인 불가"가 된다', () => {
    expect(page).toMatch(/r\?\.data\?\.items/);
    // 반대편: 서비스가 실제로 items 를 담아 낸다(양방향 대조 — 한쪽만 보면 갈라진다)
    const svc = readFileSync(DECISION_SERVICE, 'utf8');
    expect(svc, 'list() 응답에 items 가 있다').toMatch(/return \{\s*\n?\s*items,/);
  });

  it('가리키는 결정 키가 등록부에 실재한다(없는 것을 가리키면 항상 확인 불가다)', () => {
    const reg = readFileSync(DECISION_REGISTRY, 'utf8');
    expect(reg).toContain("key: 'policy.ai.clinicalFeatureScope'");
  });
});
