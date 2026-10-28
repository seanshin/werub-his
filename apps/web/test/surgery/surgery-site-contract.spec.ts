import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 오부위수술 방지 — **화면 계약** 가드.
 *
 * 🔴 지키는 결함(둘 다 실제로 있었다):
 *   ① 수술 예약 화면이 `bodySite`·`laterality` 를 **아예 보내지 않았다**(서버 DTO 에는 있었다).
 *      FE 가 안 보내면 게이트가 아무리 정교해도 판정할 값 자체가 없다.
 *   ② 수술 상세의 Time-out 줄이 **술식명을 "수술부위"로 라벨링**했다.
 *      Time-out 은 환자·부위·술식을 **각각** 대조하는 절차인데, 화면이 술식명을 부위 자리에 넣어
 *      "부위를 확인했다"고 말하고 있었다(대조가 화면에서 사라진 것과 같다).
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../../src/app', p), 'utf-8');

describe('수술 예약 화면 — 부위·좌우 전송 계약', () => {
  const src = read('(main)/patients/[id]/encounter/new/components/SurgeryEncounterLayout.tsx');
  const payload = src.slice(src.indexOf("apiClient.post('/api/v1/surgery'"), src.indexOf('onSuccess:'));

  it('예약 요청 본문에 bodySite 와 laterality 가 들어간다', () => {
    expect(payload, '예약 payload 에 bodySite 가 없다 — 오부위 방지가 입구에서 끊긴다').toMatch(/bodySite:/);
    expect(payload, '예약 payload 에 laterality 가 없다').toMatch(/laterality:/);
  });

  it('좌우 선택지에 "미지정"과 "해당 없음(NA)"이 **둘 다** 있다', () => {
    // 🔴 모르면 필수로 강제하지 않고 '미지정'을 표현할 수 있어야 한다. 그러나
    //    '아직 안 정함'과 '이 술식엔 좌우가 없음'은 다른 사실이라 선택지도 달라야 한다.
    expect(src).toMatch(/value: '',\s*label: '미지정/);
    expect(src).toMatch(/value: 'NA'/);
  });

  it('좌우 필수 판정 키워드를 화면에 복사하지 않는다(정본은 서버 config 하나)', () => {
    // 판정 키워드가 FE 에 박히면 위원회가 config 를 고쳐도 화면만 옛 규칙으로 남는다(정본이 둘·P12)
    expect(src).not.toMatch(/'슬관절'|'고관절'|'백내장'/);
  });
});

describe('수술 상세 Time-out — 술식명을 부위로 라벨링하지 않는다', () => {
  const src = read('(main)/surgery/[id]/page.tsx');
  const timeout = src.slice(src.indexOf('수술 전 확인 (Time-out)'), src.indexOf('마취 유도 + 절개'));

  it('부위 자리에 procedureName 을 넣지 않는다', () => {
    expect(timeout).not.toMatch(/부위[^|]*\$\{surgery\.procedureName\}/);
  });

  it('부위·좌우를 각각 표시하고, 비면 "미기재"라고 말한다', () => {
    expect(timeout).toMatch(/surgery\.bodySite/);
    expect(timeout).toMatch(/surgery\.laterality/);
    expect(timeout).toMatch(/미기재/);
  });
});
