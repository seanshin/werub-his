/**
 * 🔴 경보 등록부의 `emitters`(발화 지점 file:line) 드리프트 가드 — 2026-08-27 신설.
 *
 * 배경: 2026-08-20 라운드가 "emitter 줄번호가 드리프트했다. **오라클이 없어** 수기 확인한 2건만
 * 적었다 — 더 많을 수 있으나 세지 않았다"고 남겼다. 7일 뒤 오라클을 만들어 세니 **66건 중 41건**이
 * 실제 발행 지점을 가리키지 않았다(리스너 항목들이 일제히 +52줄 밀림 — 파일이 자랐는데 등록부가 안 따라감).
 *
 * `emitters` 는 `/admin/safety-gates` 경보 패널에 **사람에게 표시**된다. 틀린 줄번호는
 * "여기서 발행된다"는 거짓말이고, 아무도 그것을 확인할 수 없었다.
 *
 * 이 가드는 `scripts/alert-emitters.mjs` 와 **같은 도출 함수**를 쓴다(판정 정본이 둘이 되지 않게).
 * 갱신 방법: `node scripts/alert-emitters.mjs --write`
 *
 * 재주입: 등록부의 아무 줄번호를 바꾸거나, 발행 코드를 위아래로 옮기면 실패한다.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — 계측 정본은 스크립트다(js). 가드가 그것을 그대로 쓴다.
import { compare, deriveEmitters, readRegistry } from '../../../../scripts/alert-emitters.mjs';

describe('경보 등록부 — 발화 지점이 실제 발행 코드를 가리킨다', () => {
  it('🔴 등록부의 emitters 가 도출값과 일치한다 (갱신: node scripts/alert-emitters.mjs --write)', () => {
    const rows = compare() as Array<{ code: string; cur: string[]; real: string[]; same: boolean; orphan: boolean }>;
    // 표본이 사라지면 가드가 조용히 통과한다 — 하한을 건다(2026-08-27 실측 66, PATIENT_PUSH 4 제외).
    expect(rows.length, '등록부 추출 실패').toBeGreaterThanOrEqual(60);
    const drift = rows.filter((r) => !r.same).map((r) => `${r.code}\n    등록부: ${r.cur.join(', ')}\n    실제  : ${r.real.join(', ')}`);
    expect(drift, `발화 지점이 실제 발행 코드와 어긋난다:\n  ${drift.join('\n  ')}`).toEqual([]);
  });

  it('🔴 등재된 경보는 전부 발행하는 코드가 실재한다 (등재≠발행을 가른다)', () => {
    const rows = compare() as Array<{ code: string; orphan: boolean }>;
    const orphan = rows.filter((r) => r.orphan).map((r) => r.code);
    // 2026-08-27 실측 0건. 여기가 늘어난다면 "등재만 하고 발행하지 않는 경보"가 생긴 것이다.
    expect(orphan, `등재됐지만 발행 코드가 없다:\n  ${orphan.join(', ')}`).toEqual([]);
  });

  it('대조군 — 도출이 실제로 코드를 읽는다(무조건 통과가 아니다)', () => {
    const codes = readRegistry().map((r: { code: string }) => r.code);
    const derived = deriveEmitters(codes) as Map<string, string[]>;
    // 실재하는 발행을 실제로 찾아내는가 — 파일까지만 고정(라인은 코드 이동마다 바뀐다·정확 라인은 위 등록부 대조가 잡는다)
    expect(derived.get('VITAL_ALERT')?.some((e) => /^vitals\/vitals\.service\.ts:\d+$/.test(e)),
      'VITAL_ALERT 발화 지점을 vitals.service 에서 찾지 못했다 — 도출기가 헛돈다').toBe(true);
    // 존재하지 않는 코드는 찾아내지 않는가(무엇이든 반환하는 함수가 아니다)
    expect(deriveEmitters(['NO_SUCH_ALERT_CODE_XYZ']).size).toBe(0);
  });
});
