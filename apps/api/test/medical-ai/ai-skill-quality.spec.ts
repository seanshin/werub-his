/**
 * 🔴 AI 스킬 **품질 임계 게이트** 가드 — 기획서 chart-ai-assistant-agent §4.6·§6-1.
 *
 * 이 가드가 지키는 것(재주입하면 실패해야 한다):
 *   ④ `calls < minCalls` 인데 DEGRADED/HIDE 가 되면 실패 — **표본 부족으로는 절대 내리지 않는다**
 *   ⑤ `calls === 0` 에서 `aiRate` 가 `0` 이면 실패 — 표본 부재의 정답은 `null`(산출 불가)이다
 *   ⑥ 맵 config 에 **스칼라**를 넣었을 때 다른 스킬 설정이 사라지면 실패 — 맵 게이트를 스칼라가 덮으면 안 된다
 *   ⑦ `action === 'OFF'` 인데 effect 가 WARN/HIDE 면 실패 — 운영이 켜지 않은 게이트가 화면을 바꾸면 안 된다
 */
import { describe, it, expect } from 'vitest';
import {
  AI_QUALITY_SKILLS,
  AI_SKILL_ACTION_DEFAULT,
  AI_SKILL_MIN_AI_RATE_DEFAULT,
  AI_SKILL_MIN_CALLS_DEFAULT,
  judgeSkillQuality,
  resolveActions,
  resolveMinAiRate,
  resolveMinCalls,
} from '../../src/common/ai-skill-quality';

describe('기본값 — 임계는 위원회가 실측에서 정한다(개발자가 감으로 박지 않는다)', () => {
  it('minAiRate 는 **빈 맵(미설정)** · action 은 **전부 OFF** · minCalls 만 20', () => {
    expect(AI_SKILL_MIN_AI_RATE_DEFAULT).toEqual({});
    expect(Object.values(AI_SKILL_ACTION_DEFAULT).every((v) => v === 'OFF')).toBe(true);
    expect(AI_SKILL_MIN_CALLS_DEFAULT).toEqual({ realtimeDdx: 20, autoSoap: 20, interpretLab: 20, recommendDrugs: 20 });
    expect(AI_QUALITY_SKILLS.map((s) => s.key).sort()).toEqual(['autoSoap', 'interpretLab', 'realtimeDdx', 'recommendDrugs']);
    // 라벨은 한국어(화면 계약) — 영문 스킬명을 그대로 노출하지 않는다
    expect(AI_QUALITY_SKILLS.map((s) => s.label)).toEqual(['감별진단', 'SOAP 초안', '검사해석', '약물추천']);
  });
});

describe('⑥ 맵 config — 알려진 키만 채택 · 스칼라는 맵을 덮지 못한다', () => {
  it('🔴 action 에 스칼라 문자열을 넣어도 전 스킬 BLOCK 이 되지 않는다(전부 OFF 유지)', () => {
    expect(resolveActions('BLOCK')).toEqual({ realtimeDdx: 'OFF', autoSoap: 'OFF', interpretLab: 'OFF', recommendDrugs: 'OFF' });
    expect(resolveActions(['BLOCK'])).toEqual(AI_SKILL_ACTION_DEFAULT);
    expect(resolveActions(null)).toEqual(AI_SKILL_ACTION_DEFAULT);
  });
  it('🔴 minCalls 에 스칼라를 넣어도 다른 스킬 설정(기본 20)이 사라지지 않는다', () => {
    expect(resolveMinCalls(5)).toEqual(AI_SKILL_MIN_CALLS_DEFAULT);
    expect(resolveMinCalls('많이')).toEqual(AI_SKILL_MIN_CALLS_DEFAULT);
    // 부분 설정 — 지정한 키만 바뀌고 나머지는 기본이 남는다
    expect(resolveMinCalls({ realtimeDdx: 5 })).toEqual({ ...AI_SKILL_MIN_CALLS_DEFAULT, realtimeDdx: 5 });
    // 알려지지 않은 키·형식 위반은 무시(0 이하·비수치)
    expect(resolveMinCalls({ bogusSkill: 3, autoSoap: 0, interpretLab: 'x' })).toEqual(AI_SKILL_MIN_CALLS_DEFAULT);
  });
  it('minAiRate 는 0 초과 1 이하만 · 알려진 키만', () => {
    expect(resolveMinAiRate({ recommendDrugs: 0.5 })).toEqual({ recommendDrugs: 0.5 });
    expect(resolveMinAiRate({ recommendDrugs: 0, autoSoap: 1.5, bogus: 0.5 })).toEqual({});
    expect(resolveMinAiRate(0.5)).toEqual({});
    expect(resolveMinAiRate({ autoSoap: '0.8' })).toEqual({ autoSoap: 0.8 });
  });
  it('action 값은 gateMode 정본으로 정규화 — 오타는 fail-closed(BLOCK), 부재는 OFF', () => {
    const r = resolveActions({ realtimeDdx: 'warn', autoSoap: 'BLOCKED', interpretLab: '' });
    expect(r.realtimeDdx).toBe('WARN');
    expect(r.autoSoap).toBe('BLOCK');   // 오타는 완화하지 않는다
    expect(r.interpretLab).toBe('OFF'); // 빈 값 = 부재 = per-rule 맵의 OFF
    expect(r.recommendDrugs).toBe('OFF');
  });
});

describe('판정 — 상태와 effect', () => {
  const base = { minAiRate: 0.5, minCalls: 20, action: 'BLOCK' as const };

  it('⑦ 🔴 action OFF 면 임계를 한참 밑돌아도 effect 는 NONE(UNCONFIGURED)', () => {
    const j = judgeSkillQuality({ calls: 100, aiOk: 1, ...base, action: 'OFF' });
    expect(j.status).toBe('UNCONFIGURED');
    expect(j.effect).toBe('NONE');
    expect(j.basis).toContain('1/100'); // 분모는 언제나 함께 낸다
  });

  it('⑤ 🔴 calls 0 이면 aiRate 는 null(0 이 아니다) · UNMEASURED · effect NONE', () => {
    const j = judgeSkillQuality({ calls: 0, aiOk: 0, ...base });
    expect(j.aiRate).toBeNull();
    expect(j.status).toBe('UNMEASURED');
    expect(j.effect).toBe('NONE');
    expect(j.basis).toContain('호출 0건');
  });

  it('④ 🔴 표본 부족(calls < minCalls)은 절대 내리지 않는다 — 통과율 0%여도 effect NONE', () => {
    const j = judgeSkillQuality({ calls: 5, aiOk: 0, ...base });
    expect(j.aiRate).toBe(0);
    expect(j.status).toBe('INSUFFICIENT_SAMPLE');
    expect(j.effect).toBe('NONE');
    expect(j.basis).toContain('5/20');
  });

  it('임계 미설정이면 표본이 충분해도 판정하지 않는다', () => {
    const j = judgeSkillQuality({ calls: 100, aiOk: 3, minAiRate: null, minCalls: 20, action: 'BLOCK' });
    expect(j.status).toBe('UNCONFIGURED');
    expect(j.effect).toBe('NONE');
    expect(j.basis).toContain('임계 미설정');
  });

  it('임계 미달 — BLOCK 은 HIDE · WARN 은 WARN', () => {
    expect(judgeSkillQuality({ calls: 100, aiOk: 30, ...base })).toMatchObject({ status: 'DEGRADED', effect: 'HIDE' });
    expect(judgeSkillQuality({ calls: 100, aiOk: 30, ...base, action: 'WARN' })).toMatchObject({ status: 'DEGRADED', effect: 'WARN' });
  });

  it('임계 충족은 OK/NONE · 경계(정확히 임계)는 미달이 아니다', () => {
    expect(judgeSkillQuality({ calls: 100, aiOk: 50, ...base })).toMatchObject({ status: 'OK', effect: 'NONE' });
    expect(judgeSkillQuality({ calls: 100, aiOk: 80, ...base })).toMatchObject({ status: 'OK', effect: 'NONE' });
  });

  it('basis 는 사람이 읽는 근거 — 분자/분모·임계·표본 규약을 모두 담는다(실측 예시)', () => {
    const j = judgeSkillQuality({ calls: 14, aiOk: 5, minAiRate: 0.5, minCalls: 20, action: 'WARN' });
    expect(j.basis).toContain('AI 통과 5/14(35.7%)');
    expect(j.basis).toContain('임계 50%');
    expect(j.basis).toContain('표본 20 미만이면 판정 보류');
    expect(j.status).toBe('INSUFFICIENT_SAMPLE'); // 14 < 20 — 미달로 보이지만 판정하지 않는다
  });
});
