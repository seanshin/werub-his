/**
 * 결정 등록부 — 영역 안 세부 분류(2026-10-12 사용자 요청 "기본 설정은 의료법인 기본설정·시스템·행정 설정 … 정보보호는 규제·내부보안규정으로 구분").
 *  · 🔴 등록부 전 키가 세부 분류를 가진다(빠지면 화면에서 "기타"로 숨는다)
 *  · 🔴 세부 분류는 그 결정의 영역에 속한다(영역을 바꾸지 않는다)
 *  · 예외 키는 등록부에 실재한다 · 세부 분류마다 결정이 하나 이상 있다(빈 분류를 탭으로 그리지 않는다)
 *  · 사용자가 이름을 댄 분류가 모두 있다
 */
import { describe, it, expect } from 'vitest';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { DECISION_SUBDOMAINS, DECISION_SUBDOMAIN_OVERRIDES, decisionDomainOf, decisionSubdomainOf, decisionSubdomainMeta } from '@hospital-run/shared';

const keys = new Set(DECISION_REGISTRY.map((d) => d.key));
const subOf = (d: (typeof DECISION_REGISTRY)[number]) => decisionSubdomainOf(d.key, d.track, d.layer, decisionDomainOf(d.key, d.track));

describe('세부 분류 — 등록부 대조', () => {
  it('🔴 전 키가 세부 분류를 갖고, 그 분류는 결정의 영역에 속한다', () => {
    const bad = DECISION_REGISTRY.map((d) => ({ key: d.key, dom: decisionDomainOf(d.key, d.track), sub: subOf(d) }))
      .filter((r) => !r.sub || decisionSubdomainMeta(r.sub)?.domain !== r.dom);
    expect(bad).toEqual([]);
  });
  it('예외 키는 등록부에 실재하고, 예외 값은 정의된 분류다', () => {
    expect(Object.keys(DECISION_SUBDOMAIN_OVERRIDES).filter((k) => !keys.has(k))).toEqual([]);
    expect(Object.values(DECISION_SUBDOMAIN_OVERRIDES).filter((v) => !decisionSubdomainMeta(v))).toEqual([]);
  });
  it('세부 분류마다 결정이 하나 이상 있다', () => {
    const used = new Set(DECISION_REGISTRY.map(subOf));
    expect(DECISION_SUBDOMAINS.filter((s) => !used.has(s.key)).map((s) => s.key)).toEqual([]);
  });
  it('사용자가 이름을 댄 분류가 모두 있다', () => {
    const labels = (dom: string) => DECISION_SUBDOMAINS.filter((s) => s.domain === dom).map((s) => s.label);
    expect(labels('FOUNDATION')).toEqual(expect.arrayContaining(['의료법인 기본설정', '시스템 설정', '행정 설정']));
    expect(labels('MEDICAL')).toEqual(expect.arrayContaining(['의료 행정', '의료법', '규제', '질']));
    expect(labels('OPERATIONS')).toEqual(expect.arrayContaining(['행정운영', '의료운영', '질관련운영', '환자환경']));
    expect(labels('ADMIN')).toEqual(expect.arrayContaining(['행정규제', '행정편의', '행정프로세스']));
    expect(labels('SECURITY')).toEqual(expect.arrayContaining(['규제', '내부보안규정']));
  });
  it('영역을 모르면(옛 응답) 지어내지 않는다', () => {
    expect(decisionSubdomainOf('x', 'CLINICAL', 'STAFF', null)).toBeNull();
  });
});
