/**
 * 🔴 결정 설명자료(브리핑) 계약 가드.
 *
 * 사람 지시(2026-08-21): 허가권자·위원회·개시 축의 **설명자료를 디테일하게**.
 * 설명자료의 값은 "있다"가 아니라 **읽고 움직일 수 있는가**에 있다. 그래서 계약을 못박는다:
 *  · 지금 무슨 일이 일어나고 있는지(`statusQuo`)가 **모든 항목에** 있어야 한다 — 없으면
 *    읽는 사람은 "결정하지 않으면 어떻게 되는지"를 모른 채 결정하게 된다
 *  · 기록만 하고 적용되지 않는 경로(COMMITTEE·CODE_CHANGE)는 **남는 일을 반드시 밝힌다**(`afterDecision`)
 *    — 밝히지 않으면 "기록했으니 됐다"로 읽힌다(이 저장소의 P16: 실행하지 않고 성공 상태만 기록)
 *  · 개시 전 필수(`REQUIRED_BEFORE`)는 **확인 방법**(`verifyHow`)이 있어야 한다 — 개시 판단의 근거다
 *
 * 재주입: 아무 항목의 `statusQuo` 를 지우면 이 파일이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { DECISION_REGISTRY, LAYER_RANK } from '../../src/modules/decision-registry/decision.registry';

describe('결정 설명자료 — 사람이 읽고 움직일 수 있는가', () => {
  it('🔴 모든 항목이 "지금 무슨 일이 일어나고 있는지"를 말한다', () => {
    const missing = DECISION_REGISTRY.filter((d) => !d.statusQuo || d.statusQuo.trim().length < 20).map((d) => d.key);
    expect(missing, `statusQuo 누락·부실:\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 기록만 하는 경로는 "남는 일"을 밝힌다 — "기록했으니 됐다"로 읽히지 않게', () => {
    const needsAfter = DECISION_REGISTRY.filter((d) => d.approvalPath === 'COMMITTEE' || d.approvalPath === 'CODE_CHANGE');
    expect(needsAfter.length, '대상이 0이면 이 가드는 아무것도 보증하지 않는다').toBeGreaterThan(3);
    const missing = needsAfter.filter((d) => !d.afterDecision).map((d) => d.key);
    expect(missing, `afterDecision 누락:\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 개시 전 필수 항목은 직접 확인하는 방법을 준다', () => {
    const required = DECISION_REGISTRY.filter((d) => d.goLive === 'REQUIRED_BEFORE');
    expect(required.length, '개시 전 필수가 0이면 개시 판단이 근거를 잃는다').toBeGreaterThan(0);
    const missing = required.filter((d) => !d.verifyHow?.length).map((d) => d.key);
    expect(missing, `verifyHow 누락:\n${missing.join('\n')}`).toEqual([]);
  });

  it('선택지는 둘 이상이고, 각 선택지가 결과를 말한다 — 결과 없는 선택지는 고를 수 없다', () => {
    for (const d of DECISION_REGISTRY) {
      // 건별 판단(PER_EVENT_DIALOG)은 이 화면에서 고르지 않으므로 단일 안내 항목이 정당하다
      if (d.approvalPath !== 'PER_EVENT_DIALOG') {
        expect(d.options.length, `${d.key}: 선택지`).toBeGreaterThan(1);
      }
      for (const o of d.options) {
        expect(o.effect.trim().length, `${d.key}.${o.value}: effect 가 비었다`).toBeGreaterThan(10);
      }
    }
  });

  it('🔴 선행 조건은 하위 층을 가리키지 않는다 — 하위가 상위의 조건이 될 수 없다', () => {
    for (const d of DECISION_REGISTRY) {
      for (const dep of d.dependsOn ?? []) {
        const target = DECISION_REGISTRY.find((x) => x.key === dep);
        expect(target, `${d.key}: 등록부에 없는 선행 조건 ${dep}`).toBeTruthy();
        expect(LAYER_RANK[target!.layer], `${d.key} → ${dep}: 하위 층을 선행 조건으로 삼았다`)
          .toBeGreaterThanOrEqual(LAYER_RANK[d.layer]);
      }
    }
  });

  it('🔴 개시 전 필수인데 아무것도 막지 않는다고 적혀 있지 않다 — 개시를 막는 이유가 있어야 한다', () => {
    for (const d of DECISION_REGISTRY.filter((x) => x.goLive === 'REQUIRED_BEFORE')) {
      const says = `${d.blocks ?? ''}${d.statusQuo}`;
      expect(says.trim().length, `${d.key}: 개시 전 필수인데 무엇이 걸리는지 적혀 있지 않다`).toBeGreaterThan(20);
    }
  });

  it('허가권(authority)은 사람 이름이 아니라 역할·직책이다', () => {
    for (const d of DECISION_REGISTRY) {
      expect(d.authority.trim().length, `${d.key}: authority 비었음`).toBeGreaterThan(1);
      // 이름처럼 보이는 2~3글자 한글 단독 표기를 막는다(김철수 등)
      expect(d.authority, `${d.key}: 사람 이름으로 보인다 — 역할·직책으로 적는다`).not.toMatch(/^[가-힣]{2,3}$/);
    }
  });

  it('goLive 값은 세 가지 중 하나다 — 모호한 상태를 만들지 않는다', () => {
    for (const d of DECISION_REGISTRY) {
      expect(['REQUIRED_BEFORE', 'CAN_FOLLOW', 'NOT_RELATED'], d.key).toContain(d.goLive);
    }
  });
});
