import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 비대면 예약 담당의 계약 가드 — 이연 회수(2026-08-18).
 *
 * 종전 동작: 원내 '새 원격진료' 예약 화면에 **담당의 입력이 없었다.** 서버는 담당의를
 * `@CurrentUser('id')`(호출자)로 박았고, 그 EP 는 ADMIN·NURSE 도 부를 수 있다 —
 * 관리자·간호사가 잡은 예약의 담당의는 **관리자·간호사 자신**이 되고, 그 세션은 어느 의사의
 * 목록에도 뜨지 않는다. 환자는 누가 진료할지 모르는 채로 예약이 확정됐다.
 *
 * 규약: 누가 볼지 정하지 않은 예약은 만들지 않는다 — 화면은 담당의를 고르게 하고,
 *       고르지 않으면 전송 버튼이 잠긴다(서버도 fail-closed 로 거절한다).
 */
const BOOKING = join(process.cwd(), 'src', 'app', '(main)', 'telehealth', 'page.tsx');
const PORTAL = join(process.cwd(), 'src', 'app', 'portal', '_services', 'ServicesTab.tsx');

describe('원내 원격진료 예약 화면은 담당의를 고르게 한다', () => {
  const src = readFileSync(BOOKING, 'utf8');

  it('예약 폼이 담당의(doctorId)를 들고 있다', () => {
    expect(src).toMatch(/doctorId: ''/);
    expect(src).toContain('담당의');
  });

  it('의사 목록을 실제로 불러온다(임의 배정·추측 금지)', () => {
    expect(src).toContain('/api/v1/users/doctors');
  });

  it('🔴 담당의를 고르지 않으면 예약 버튼이 잠긴다', () => {
    expect(src).toMatch(/disabled=\{[^}]*!form\.doctorId/);
  });

  it('목록을 못 불러오면 "없다"가 아니라 못 불러왔다고 말한다', () => {
    expect(src).toContain('의사 목록을 불러오지 못했습니다');
  });

  /**
   * 🔴 **UI 언어 배선(2026-09-09) 이후에도 같은 사실을 본다.** 문구가 `<T k="담당의" />` 로 감싸이면
   *    `'>담당의</th>'` 같은 **렌더 형태 단언은 깨지고**, 반대로 `not.toContain` 류는 조용히 통과한다.
   *    원문이 곧 i18n 키라 문구 자체는 항상 남는다 — 그래서 두 형태를 모두 받는다.
   */
  it('🔴 목록·상세가 담당의를 보여준다(관리자·간호사는 전체 세션을 본다)', () => {
    expect(src).toMatch(/>담당의<\/th>|<T k="담당의" \/>\s*<\/th>/);
    expect(src).toMatch(/s\.doctor\?\.familyName/);
    expect(src).toMatch(/selected\.doctor\?\.familyName/);
    // 담당의가 비어 있으면 비운 채 두지 않고 '미지정'이라고 말한다
    expect(src).toContain('미지정');
  });
});

describe('환자 포털 예약도 진료과·담당의를 고른 뒤에 확정한다', () => {
  const src = readFileSync(PORTAL, 'utf8');

  it('진료과 → 담당의 → 시간 순서로 고른 값을 그대로 보낸다', () => {
    expect(src).toContain('/api/v1/portal/telehealth-doctors?department=');
    expect(src).toMatch(/telehealth-book[\s\S]{0,200}doctorId/);
  });
});
