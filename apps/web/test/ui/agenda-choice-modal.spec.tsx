import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 의결 화면의 **선택지** 배선 (2026-08-27 · 계획서 §3.1).
 *
 * 🔴 종전 의결 모달은 집행 대상을 **원시 JSON 으로 위원이 손수 적게** 했다
 *    (`[{"kind":"GATE_MODE","target":{…}}]`). 그 순간 정본이 둘이 된다 —
 *    등록부·안건이 든 선택지와, 위원이 적은 값.
 *
 * 이 가드는 **소스 대조**다. 모달이 데이터 페칭·모달 열림에 얽혀 있어 렌더 테스트가
 * 실제보다 많은 것을 목으로 만들게 되는데, 그러면 "내가 가정한 모양"을 검증하게 된다
 * (이 저장소가 반복해 겪은 함정). 대신 **화면이 무엇을 보내고 무엇을 감추는가**를 못박는다.
 *
 * 재주입: 선택지 UI 를 지우거나, 선택지가 있는데 JSON 칸을 그대로 열어두면 실패한다.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '../../src/app/(main)/admin/governance/page.tsx'), 'utf-8');

describe('의결 모달 — 위원이 집행 대상을 다시 타이핑하지 않는다', () => {
  it('🔴 안건 선택지를 라디오로 고르게 한다', () => {
    expect(SRC).toContain('어느 안으로 의결합니까?');
    expect(SRC).toMatch(/name="agenda-choice"/);
    // 고르기 전에 결과를 알아야 한다 — effect 를 그대로 보여준다
    expect(SRC).toMatch(/\{o\.effect\}/);
  });

  it('🔴 고른 선택을 스냅샷과 함께 보낸다(값만 보내지 않는다)', () => {
    expect(SRC).toMatch(/chosenOption:\s*\{\s*value:\s*choice,\s*snapshot:\s*options/);
  });

  it('🔴 선택지가 있으면 원시 JSON 바인딩 칸을 감춘다 — 정본이 둘이 되지 않게', () => {
    expect(SRC).toMatch(/\(!hasOptions \|\| special\) && \(/);
    // 그리고 손으로 적은 액션을 함께 보내지 않는다
    expect(SRC).toMatch(/hasOptions && !special \? \[\] : actions/);
  });

  it('🔴 "원안을 수정하여 의결" 자리가 있고, 사유 없이는 의결 버튼이 열리지 않는다', () => {
    expect(SRC).toContain('CHOSEN_MODIFIED');
    expect(SRC).toContain('CHOSEN_NONE_OF_ABOVE');
    expect(SRC).toMatch(/choiceReady\s*=\s*!hasOptions \|\| \(!!choice && \(!special \|\| !!choiceNote\.trim\(\)\)\)/);
    expect(SRC).toMatch(/disabled=\{!resolution\.trim\(\) \|\| !choiceReady \|\| busy\}/);
  });

  it('🔴 수정 의결이 원안을 집행하지 않는다는 사실을 화면이 말한다', () => {
    expect(SRC).toContain('원안의 자동 반영은');
    expect(SRC).toContain('실행되지 않습니다');
  });

  it('🔴 자동 반영 없음과 대상 아님을 구분해 말한다(둘 다 집행 0건이지만 다른 사실)', () => {
    expect(SRC).toContain('자동 반영 없음');
    expect(SRC).toContain('자동 반영 대상 아님');
  });

  it('🔴 P0-b — 법적 검토 항목을 근거로 자동 유입하지 않는다', () => {
    // `legalReview` 는 "검토해야 할 항목"이지 "검토했다는 사실"이 아니다.
    // 자동으로 basis 에 넣으면 **확인하지 않은 것을 확인한 것처럼** 기록된다(P16).
    expect(SRC).toContain('검토해야 할 항목');
    expect(SRC).toContain('검토했다는 사실이 아닙니다');
    expect(SRC).toContain('자동으로 담기지 않습니다');
    // 초기 상태가 비어 있어야 한다 — legalReview 로 미리 채우면 안 된다
    expect(SRC).toMatch(/useState<Record<BasisKind, string\[\]>>\(\{ legal: \[\], accreditation: \[\], evidence: \[\] \}\)/);

    /**
     * 🔴 처음 이 가드는 `not.toMatch(/setBasis\([^)]*legalReview/)` 였는데,
     *    `setBasis((b) => ({ ...b, legal: legalReview }))` 는 `(b)` 의 `)` 에서 끊겨 **매칭되지 않았다**
     *    — 결함을 재주입해도 통과했다(또 한 번 "다른 이유로 통과한 가드").
     *    정규식 한 줄 대신 **문장 단위로 훑는다.**
     */
    const lines = SRC.split('\n');
    const autoFill = lines
      .map((ln, i) => ({ ln, i, win: lines.slice(i, i + 3).join(' ') }))
      .filter(({ ln, win }) => /setBasis\s*\(/.test(ln) && /legalReview/.test(win));
    expect(autoFill.map((x) => x.ln.trim()),
      'legalReview 를 근거에 자동으로 넣으면 확인하지 않은 것을 확인한 것처럼 기록된다').toEqual([]);
    // useEffect 로 우회하는 형태도 막는다
    const effectFill = lines
      .map((ln, i) => lines.slice(i, i + 3).join(' '))
      .filter((win) => /useEffect\s*\(/.test(win) && /legalReview/.test(win) && /setBasis/.test(win));
    expect(effectFill, 'useEffect 로 근거를 미리 채우는 것도 자동 유입이다').toEqual([]);
  });

  it('🔴 P0-b — 손대지 않은 갈래는 보내지 않는다(미기재 ≠ 해당 없음)', () => {
    expect(SRC).toMatch(/for \(const k of BASIS_KINDS\) if \(basis\[k\]\.length\)/);
    expect(SRC).toMatch(/return any \? out : undefined/);
  });

  it('🔴 P0-b — 근거를 강제하지 않는다(강제하면 아무 문장이나 채워진다)', () => {
    expect(SRC).toContain('적지 않아도 의결됩니다');
    // 의결 버튼 조건에 근거가 들어가면 안 된다
    expect(SRC).toMatch(/disabled=\{!resolution\.trim\(\) \|\| !choiceReady \|\| busy\}/);
  });

  it('어휘는 shared 정본에서 온다 — 화면이 지어내지 않는다', () => {
    expect(SRC).toMatch(/from '@hospital-run\/shared'/);
    expect(SRC).toContain('CHOSEN_SPECIAL_LABEL');
  });
});
