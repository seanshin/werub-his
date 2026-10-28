import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALLERGY_STATUSES,
  ALLERGY_STATUS_META,
  allergyStatusMeta,
  allergyStatusIsReassuring,
} from '@hospital-run/shared';

/**
 * 🔴 C1 — 차트 헤더가 **아무도 묻지 않은 알레르기를 "없음"이라 단언**하고 있었다(2026-08-26).
 *    `allergies.length === 0` → 초록 `NKDA`(= "물어봤고 없었다").
 *    운영 실측: 환자 874명 · 알레르기 기록 12명 · **평가를 받은 환자 0명**
 *    → **862명이 근거 없는 초록 배지**를 달고 처방 화면에 노출됐다.
 *
 * 🔴 서버에는 4상태가 진작 있었고 포털·진료입력은 그것을 썼다. **차트만** 2상태로 접었다.
 */
const SVC = join(process.cwd(), 'src/modules/allergy/allergy.service.ts');
const HEADER = join(process.cwd(), '../web/src/app/(main)/patients/[id]/components/PatientHeader.tsx');
// 🔴 2026-08-27 — 배지 정본이 `(main)/patients/[id]/components/` 안에 있어서 회진 보드·간호 타블렛·
//    원격진료 패널이 **자기 판정을 새로 적고 있었다.** 라우트 밖으로 옮겼다(이 경로도 함께 옮긴다).
const BADGE = join(process.cwd(), '../web/src/components/clinical/allergy-status.tsx');

describe('알레르기 상태 어휘', () => {
  const svc = readFileSync(SVC, 'utf8');

  /**
   * 🔴 **텍스트 대조에서 컴파일러 강제로 올렸다**(2026-08-29).
   *    종전엔 서버가 같은 네 값을 **자기 union 으로 또 들고** 있었고, 이 테스트가
   *    두 목록을 문자열로 비교했다. 지금은 일치했지만 **한쪽만 늘리면 갈라질 수 있었다.**
   *    이제 서버 타입이 정본에서 **파생**되므로 갈라질 자리 자체가 없다 —
   *    정본에 없는 값을 쓰면 **tsc 가 잡는다**(텍스트 가드보다 강하다).
   */
  it('🔴 서버 상태 타입이 정본에서 파생된다 — 어휘를 다시 적지 않는다', () => {
    expect(svc, '서버가 어휘를 자기 union 으로 다시 적었다')
      .not.toMatch(/export type AllergyStatus\s*=\s*'/);
    expect(svc, '정본 타입에서 파생한다').toMatch(/export type AllergyStatus = AllergyStatusKey;/);
    expect(svc, '정본을 import 한다').toMatch(/AllergyStatusKey.*from '@hospital-run\/shared'/);
  });

  it('정본 어휘가 4상태 그대로다(대조군 — 정본이 줄면 위 검사가 의미를 잃는다)', () => {
    expect([...ALLERGY_STATUSES].sort())
      .toEqual(['HAS_ALLERGIES', 'NOT_ASSESSED', 'NO_KNOWN_ALLERGIES', 'UNABLE_TO_ASSESS']);
  });

  it('🔴 안심시키는 상태는 정확히 하나다 — 나머지는 전부 주의·위험', () => {
    const safe = ALLERGY_STATUSES.filter((s) => ALLERGY_STATUS_META[s].tone === 'safe');
    expect(safe).toEqual(['NO_KNOWN_ALLERGIES']);
  });

  it('🔴 미확인을 "없음"이라 말하지 않는다', () => {
    const meta = ALLERGY_STATUS_META.NOT_ASSESSED;
    expect(meta.tone).toBe('warn');
    expect(meta.label).not.toMatch(/없음/);
    expect(meta.meaning).toMatch(/없다는 뜻이 아닙니다/);
  });

  it('🔴 모르는 값을 안전하다고 말하지 않는다', () => {
    expect(allergyStatusMeta('SOMETHING_NEW').tone).toBe('warn');
    // 대조군: 아는 값은 제 색으로 나온다(무조건 warn 이면 가드가 헛돈다)
    expect(allergyStatusMeta('NO_KNOWN_ALLERGIES').tone).toBe('safe');
    expect(allergyStatusMeta('HAS_ALLERGIES').tone).toBe('danger');
  });

  it('🔴 평가 기록이 없으면 안심 상태가 성립하지 않는다', () => {
    expect(allergyStatusIsReassuring('NO_KNOWN_ALLERGIES', null)).toBe(false);
    expect(allergyStatusIsReassuring('NOT_ASSESSED', '2026-08-26')).toBe(false);
    // 대조군: 평가 기록이 있으면 성립한다
    expect(allergyStatusIsReassuring('NO_KNOWN_ALLERGIES', '2026-08-26')).toBe(true);
  });
});

describe('차트 헤더', () => {
  const header = readFileSync(HEADER, 'utf8');
  const badge = readFileSync(BADGE, 'utf8');

  it('🔴 건수 0 을 초록으로 단언하던 자리가 사라졌다', () => {
    expect(header).not.toMatch(/allergies\.length > 0 \?[\s\S]{0,600}NKDA/);
    expect(header).toMatch(/<AllergyStatusBadge/);
  });

  it('배지는 서버 상태 EP 를 읽는다 — 화면이 스스로 판정하지 않는다', () => {
    expect(badge).toMatch(/allergies\/status/);
    expect(badge).toMatch(/allergyStatusMeta/);
  });

  it('🔴 `queryFn` 안에서 실패를 기본값으로 접지 않는다', () => {
    expect(badge).not.toMatch(/queryFn:[\s\S]{0,200}\.catch\(/);
  });

  it('🔴 로딩 중을 "확인 불가"로 말하지 않는다', () => {
    expect(badge).toMatch(/isLoading[\s\S]{0,300}확인 중/);
  });

  it('🔴 조회 실패를 안전한 쪽으로 그리지 않는다', () => {
    expect(badge).toMatch(/isError[\s\S]{0,400}확인 못 함/);
  });

  it('🔴 팔찌는 "확인했고 없음"과 "아무도 묻지 않음"을 구분해 찍는다(IPSG.1)', () => {
    expect(header).toMatch(/wristbandAllergyLine/);
    expect(header).toMatch(/확인되지 않음 — 투약 전 확인 필요/);
    // 대조군: 확인된 NKDA 는 그렇게 찍는다
    expect(header).toMatch(/확인함 · 없음\(NKDA\)/);
  });
});
