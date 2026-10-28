import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 낙상/욕창 재평가 · 임상도구 검수 화면 가드 — 2026-08-14 (화면 점검 W8 · 패턴 P1·P11·P12·P17).
 *
 * 🔴 원 결함:
 *   - `risk_reassessment_schedules` 0행(재원 5명 전원 스케줄 부재)인데 화면은
 *     **"지연된 재평가가 없습니다"** 라고 안심시켰다(P17). 표본 부재는 '없음'이 아니라 '산출 불가'다.
 *   - FE 가 서버에 없는 필드(`scheduleId`·`riskLevel`)를 읽어 '지금 평가'가 400,
 *     위험도 칸이 영구 '-', 유형 키가 'FALL'/'PRESSURE' 라 통계가 영구 0 이었다(P11).
 *   - 재평가 주기 정본이 FE·BE 두 벌이고 값이 서로 반대였다(P12).
 *   - 임상도구 89개 전부 미검증인데 사용을 막는 곳은 항암 레지멘 1건뿐인 사실을 화면이 말하지 않았다.
 *
 * 이 스펙은 소스 텍스트를 직접 본다 — 화면 렌더 없이도 재발을 잡기 위해서다. 완화 금지.
 */

const SRC = path.join(__dirname, '..', '..', 'src');
const RISK_PAGE = path.join(SRC, 'app', '(main)', 'admin', 'risk-reassessment', 'page.tsx');
const CCV_PAGE = path.join(SRC, 'app', '(main)', 'admin', 'clinical-chart-verification', 'page.tsx');

const risk = fs.readFileSync(RISK_PAGE, 'utf8');

/**
 * 🔴 i18n 배선이 이 가드를 죽일 뻔했다(2026-09-09 · 정본 `ui-locale-i18n.plan.md` §10).
 * 렌더 문구가 `>원문<` 에서 `<T k="원문" />` 로 바뀌면 `indexOf('>원문<')` 는 -1 이 되고,
 * 부정 단언은 **조용히 통과**한다. 기준선을 낮추지 말고 **두 형태를 모두 찾도록 넓힌다**
 * (원문이 키로 그대로 남아 있으므로 검색 가능하다).
 */
export const renderPointOf = (src: string, text: string): number => {
  const plain = src.indexOf(`>${text}<`);
  if (plain > -1) return plain;
  const t = src.search(new RegExp(`<T\\s+k=["']${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  return t;
};
const ccv = fs.readFileSync(CCV_PAGE, 'utf8');

describe('재평가 화면 — 표본 0 을 "지연 없음"이라 말하지 않는다', () => {
  it('표본 유무(hasSample)를 서버 stats 에서 받아 판정한다', () => {
    expect(risk).toMatch(/hasSample/);
    expect(risk).toMatch(/typeof stats\?\.hasSample === 'boolean'/);
  });

  it('"지연된 재평가가 없습니다" 는 표본이 있을 때만 말한다', () => {
    // 렌더되는 문구(주석 아님)가 hasSample 삼항의 참 가지 안에만 있어야 한다
    const idx = renderPointOf(risk, '지연된 재평가가 없습니다');
    expect(idx, '렌더 문구를 찾지 못함(`>원문<`·`<T k="원문">` 두 형태 모두)').toBeGreaterThan(-1);
    const before = risk.slice(Math.max(0, idx - 300), idx);
    expect(before).toMatch(/hasSample\s*\?/);
    // 표본 유무를 묻지 않고 무조건 말하는 형태가 남아 있으면 안 된다
    // 🔴 배선 후 형태(`<p ...><T k="지연된 재평가가 없습니다" />`)도 함께 막는다 — 한 형태만 막으면 조용히 통과한다
    expect(risk).not.toMatch(/overdueAlerts\.length === 0 \? \(\s*<div[^>]*>\s*<p[^>]*>(?:지연된 재평가가 없습니다|<T\s+k=["']지연된 재평가가 없습니다["'])/);
  });

  it('표본이 없을 때의 문구는 "스케줄이 등록되지 않았습니다 / 산출 불가" 다', () => {
    expect(risk).toMatch(/재평가 스케줄이 등록되지 않았습니다/);
    expect(risk).toMatch(/산출할 수 없습니다|산출 불가/);
  });

  it('표본 없을 때 지표는 0 이 아니라 산출 불가로 표시된다', () => {
    expect(risk).toMatch(/const metric = [\s\S]*?'산출 불가'/);
  });
});

describe('재평가 화면 — FE↔서버 계약', () => {
  it('지연 목록에서 스케줄 식별자는 id 를 쓴다 (scheduleId 는 서버에 없다)', () => {
    expect(risk).not.toMatch(/alert\.scheduleId/);
    expect(risk).toMatch(/openAssessModal\(alert\.id,/);
  });

  it('위험등급은 DB 컬럼명 lastRiskLevel 로 읽는다', () => {
    expect(risk).toMatch(/lastRiskLevel/);
    // `riskLevel` 단독 참조(=존재하지 않는 필드)가 남아 있으면 안 된다
    expect(risk).not.toMatch(/\b(alert|sch|s)\.riskLevel\b/);
  });

  it('평가 유형 키는 FALL_RISK / PRESSURE_ULCER 다', () => {
    expect(risk).toMatch(/FALL_RISK:\s*'낙상'/);
    expect(risk).toMatch(/PRESSURE_ULCER:\s*'욕창'/);
    expect(risk).not.toMatch(/\{\s*FALL:\s*'낙상'/);
  });

  it('평가 제출 본문은 totalScore 계약을 쓴다', () => {
    expect(risk).toMatch(/totalScore/);
  });
});

describe('재평가 화면 — 주기 정본은 서버 하나', () => {
  it('FE 가 재평가 주기를 계산하지 않는다 (getRiskInterval 제거)', () => {
    expect(risk).not.toMatch(/function getRiskInterval/);
    expect(risk).not.toMatch(/suggestedInterval:/);
  });

  it('임계값 미리보기는 서버 정본과 같은 값이어야 한다 (Morse 25/45 · Braden 12/14)', () => {
    expect(risk).toMatch(/score >= 45/);
    expect(risk).toMatch(/score >= 25/);
    expect(risk).toMatch(/score <= 12/);
    expect(risk).toMatch(/score <= 14/);
  });
});

describe('임상도구 검수 화면 — 미검증 도구가 사용 가능하다는 사실을 말한다', () => {
  it('미검증 건수와 "사용은 차단되지 않습니다" 를 고지한다', () => {
    expect(ccv).toMatch(/미검증 임상도구/);
    expect(ccv).toMatch(/사용은 차단되지 않습니다/);
  });

  it('사용을 막는 곳이 항암 레지멘 1건뿐이라는 사실을 밝힌다', () => {
    expect(ccv).toMatch(/항암 레지멘의 처방 초안 생성 1건뿐/);
  });

  it('사용 차단 정책이 위원회 판단 영역임을 밝힌다', () => {
    expect(ccv).toMatch(/위원회 판단 영역/);
  });

  it('자가 승인 차단 사실을 검수 패널이 안내한다', () => {
    expect(ccv).toMatch(/본인의 재승인은 서버가 거부/);
  });

  it('승인 실패 사유를 "기록 실패" 로 뭉개지 않는다', () => {
    expect(ccv).toMatch(/onError:\s*\(e: unknown\)/);
  });
});
