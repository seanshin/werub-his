/**
 * 🔴 음성 EMR 이 고위험약을 **한글 부분문자열**로 판정하고 있었다.
 *
 * 2026-08-27 이전 `orchestrator.ts:34,49`:
 *     const HIGH_ALERT = ['헤파린','인슐린','와파린','칼륨','kcl','모르핀','펜타닐','디곡신'];
 *     r.drug.toLowerCase().includes(h.toLowerCase())
 *   · 정본(`medication_codes.high_alert_flag` 634품목·`high_alert_category` 7분류 +
 *     shared `requiresIndependentDoubleCheck`)을 **한 번도 부르지 않았다.**
 *   · 목록이 한글뿐이라 `heparin`·`insulin` 같은 **영문 성분명·상품명 발화는 표식이 안 붙었다**
 *     — v4.4.0 "DUR 55룰 중 43룰이 한글 룰·영문 마스터라 매칭 0" 과 같은 형태.
 *   · 경로(IV/PO)를 보지 않아 독립 이중확인 대상 여부는 말할 수 없었다.
 *
 * 재주입: `resolveRxHighAlert` 를 종전 방식(발화어 8개 부분문자열)으로 되돌리거나,
 *         마스터 표식(`highAlertFlag`)을 보지 않게 하면 이 파일이 실패한다.
 * 대조군: 고위험이 아닌 약이 고위험으로 뜨지 않는지 · 판정 못 한 것을 "아님"으로 말하지 않는지
 *         함께 본다(전부 true 로 답하는 가드는 아무것도 보증하지 않는다).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveRxHighAlert, screenSpokenTerm, SPOKEN_HIGH_ALERT_TERMS } from '../../src/modules/voice-emr/high-alert-screen';
import { buildRxOutcome } from '../../src/modules/voice-emr/orchestrator';
import { matchNbest, type Candidate } from '../../src/modules/voice-emr/nbest-matcher';
import { HIGH_ALERT_CATEGORIES } from '@hospital-run/shared';

const ORCHESTRATOR = path.join(__dirname, '..', '..', 'src', 'modules', 'voice-emr', 'orchestrator.ts');

/** 마스터 행을 흉내낸 후보 — `highAlertFlag` 가 **실려 있다**(= 마스터가 답했다). */
const master = (over: Partial<Candidate> & { name: string }): Candidate => ({
  code: 'M0001', highAlertFlag: false, highAlertCategory: null, ...over,
});

describe('정본을 부른다 — 발화어 목록이 판정 주체가 아니다', () => {
  it('🔴 orchestrator 에 고위험 어휘 하드코딩이 남아 있지 않다', () => {
    const src = fs.readFileSync(ORCHESTRATOR, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/const\s+HIGH_ALERT\s*=/);
    expect(src).toMatch(/high-alert-screen/);
  });

  it('🔴 판정 모듈이 shared 정본(`requiresIndependentDoubleCheck`)을 실제로 부른다', () => {
    const screen = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'modules', 'voice-emr', 'high-alert-screen.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(screen).toMatch(/from\s+'@hospital-run\/shared'/);
    // 부르는 모양만 갖춘 코드를 막는다 — 실제 호출부가 있어야 한다(v4.2.0 `roundBy` 사례)
    expect(screen).toMatch(/requiresIndependentDoubleCheck\(\{/);
  });

  it('🔴 마스터 표식이면 발화 언어와 무관하게 고위험이다 — 영문 발화도 잡는다', () => {
    const rows = [master({ code: 'A1', name: 'Heparin Sodium Inj 5000IU', highAlertFlag: true, highAlertCategory: 'ANTICOAGULANT' })];
    for (const spoken of ['헤파린', 'heparin', 'Heparin Sodium']) {
      const v = resolveRxHighAlert({ spokenTerm: spoken, candidates: rows, route: 'IV' });
      expect(v.highAlert, spoken).toBe(true);
      expect(v.source, spoken).toBe('MASTER');
      expect(v.category, spoken).toBe('ANTICOAGULANT');
    }
  });

  it('🔴 종전 한글 목록에 없는 약도 마스터 표식이면 고위험이다(목록이 판정하지 않는다)', () => {
    // 빈크리스틴은 종전 8개 목록에 없다 — 마스터가 항암제로 표식하면 그걸로 족하다.
    const rows = [master({ code: 'C1', name: '빈크리스틴주', highAlertFlag: true, highAlertCategory: 'CHEMOTHERAPY' })];
    const v = resolveRxHighAlert({ spokenTerm: 'vincristine', candidates: rows, route: 'IV' });
    expect(v.highAlert).toBe(true);
    expect(v.source).toBe('MASTER');
    expect(v.doubleCheckRequired).toBe(true); // ISMP 상시 목록
  });

  it('경로에 따라 독립 이중확인 대상이 갈린다 — shared 정본 규칙을 그대로 쓴다', () => {
    const rows = [master({ code: 'O1', name: '모르핀황산염정', highAlertFlag: true, highAlertCategory: 'OPIOID' })];
    expect(resolveRxHighAlert({ spokenTerm: '모르핀', candidates: rows, route: 'IV' }).doubleCheckRequired).toBe(true);
    // 경구 마약성 진통제는 ISMP 상시 목록이 아니다 — 전부에 걸면 형식화된다
    expect(resolveRxHighAlert({ spokenTerm: '모르핀', candidates: rows, route: 'PO' }).doubleCheckRequired).toBe(false);
    // 경로 미상은 안전측
    expect(resolveRxHighAlert({ spokenTerm: '모르핀', candidates: rows, route: null }).doubleCheckRequired).toBe(true);
  });
});

describe('마스터가 답하지 않았을 때 — 발화어는 후단일 뿐, 판정을 낮추지 않는다', () => {
  it('🔴 후보 0건이면 발화어로 선별하고 그 사실을 밝힌다(한/영 모두)', () => {
    for (const spoken of ['헤파린 오천 단위', 'heparin 5000 units']) {
      const v = resolveRxHighAlert({ spokenTerm: spoken, candidates: [], route: 'IV' });
      expect(v.highAlert, spoken).toBe(true);
      expect(v.source, spoken).toBe('TERM_SCREEN');
      expect(v.reason, spoken).toContain('발화어');
    }
  });

  it('🔴 `highAlertFlag` 가 없는 후보는 "마스터가 답한 것"으로 세지 않는다', () => {
    // 필드 없는 후보를 false 로 읽으면 마스터를 안 보고 "고위험 아님"이라 말하게 된다.
    const noField: Candidate[] = [{ code: 'X', name: '아세트아미노펜정 500mg' }];
    const v = resolveRxHighAlert({ spokenTerm: '헤파린', candidates: noField, route: 'IV' });
    expect(v.highAlert).toBe(true);
    expect(v.source).toBe('TERM_SCREEN');
  });

  it('🔴 마스터 후보에 표식이 없어도 발화어에 걸리면 내리지 않는다(안전측)', () => {
    const rows = [master({ code: 'Z1', name: '전혀 다른 약', highAlertFlag: false })];
    const v = resolveRxHighAlert({ spokenTerm: '펜타닐', candidates: rows, route: 'IV' });
    expect(v.highAlert).toBe(true);
    expect(v.source).toBe('TERM_SCREEN');
  });

  it('🔴 아무것도 못 찾으면 "고위험 아님"이 아니라 **미확인**이라고 말한다', () => {
    const v = resolveRxHighAlert({ spokenTerm: '어쩌구약', candidates: [], route: undefined });
    expect(v.highAlert).toBe(false);
    expect(v.source).toBe('UNSCREENED');
    expect(v.doubleCheckRequired).toBeNull(); // 판정 불가는 null — false 로 뭉개지 않는다
    expect(v.reason).toContain('확인하지 못했');
  });
});

describe('대조군 — 무조건 고위험이라 말하지 않는다', () => {
  it('마스터가 답했고 표식이 없으면 고위험이 아니다', () => {
    const rows = [
      master({ code: 'N1', name: '아세트아미노펜정 500mg' }),
      master({ code: 'N2', name: '아모크라정' }),
    ];
    const v = resolveRxHighAlert({ spokenTerm: '아세트아미노펜', candidates: rows, route: 'PO' });
    expect(v.highAlert).toBe(false);
    expect(v.source).toBe('MASTER');
    expect(v.doubleCheckRequired).toBe(false);
    expect(v.reason).toContain('표식이 없습니다');
  });

  it('선별어에 걸리지 않는 흔한 약은 선별에서도 통과한다', () => {
    for (const t of ['메트포르민', 'metformin', '아모크라', 'amoxicillin']) {
      expect(screenSpokenTerm(t), t).toBeNull();
    }
  });

  it('선별 목록이 비어 있지 않고, 분류는 전부 정본 어휘이거나 명시적 null 이다', () => {
    expect(SPOKEN_HIGH_ALERT_TERMS.length).toBeGreaterThanOrEqual(7);
    for (const row of SPOKEN_HIGH_ALERT_TERMS) {
      expect(row.terms.length).toBeGreaterThan(0);
      if (row.category !== null) expect(HIGH_ALERT_CATEGORIES).toContain(row.category);
    }
    // 🔴 디곡신은 마스터 7분류 어디에도 없다 — 분류를 지어내지 않고 null 로 둔다(안전측 처리는 정본이 한다)
    const digoxin = SPOKEN_HIGH_ALERT_TERMS.find((r) => r.terms.includes('디곡신'));
    expect(digoxin?.category).toBeNull();
  });
});

describe('outcome 조립 — 판정 결과가 카드까지 실린다', () => {
  it('order-rx 는 판정 출처·사유·이중확인 여부를 함께 낸다', () => {
    const rows: Candidate[] = [master({ code: 'I1', name: '휴마로그주', highAlertFlag: true, highAlertCategory: 'INSULIN' })];
    const o = buildRxOutcome({
      patient: { name: '홍길동', mrn: 'M1' },
      term: '인슐린', nbest: matchNbest('인슐린', rows), route: 'SC',
    });
    expect(o.kind).toBe('order-rx');
    expect(o.needsConfirm).toBe(true);
    expect(o.term).toBe('인슐린');
    expect(typeof o.highAlertReason).toBe('string');
    expect(o.highAlertReason.length).toBeGreaterThan(0);
    expect(['MASTER', 'TERM_SCREEN', 'UNSCREENED']).toContain(o.highAlertSource);
    expect(o.highAlert).toBe(true);
    expect(o.doubleCheckRequired).toBe(true); // 인슐린 = ISMP 상시 목록
  });
});
