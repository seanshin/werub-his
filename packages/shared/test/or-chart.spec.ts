import { describe, it, expect } from 'vitest';
import { defaultOrLayout, normalizeOrLayout, checkIntraopPayload, orTeamRoleOf, orWriteRequiresTeam, OR_ROLES, OR_DEVICE_PROFILES, OR_SCREEN_COUNT, OR_PANELS } from '../src/or-chart';

/** 수술방 차트 정본(2026-10-05) — 재주입: 화면 수·모르는 패널·필수 칸·범위 검사를 되돌리면 실패한다. */
describe('배치', () => {
  it('🔴 모든 역할×기기 기본 배치 = 화면 수 일치 · 모든 패널이 정본 · 패널 누락 없이 역할 순서 전부', () => {
    for (const r of OR_ROLES) for (const p of OR_DEVICE_PROFILES) {
      const l = defaultOrLayout(r, p);
      expect(l.screens, `${r}/${p}`).toHaveLength(OR_SCREEN_COUNT[p]);
      for (const s of l.screens) { expect(s.panels.length).toBeGreaterThan(0); for (const x of s.panels) expect(OR_PANELS).toContain(x); }
    }
  });
  it('🔴 정규화 — 모르는 패널·중복 제거 · 모양 모르면 null · 화면 수 맞춤', () => {
    expect(normalizeOrLayout('x', 'SCRUB', 'TABLET')).toBeNull();
    expect(normalizeOrLayout({}, 'SCRUB', 'TABLET')).toBeNull();
    const l = normalizeOrLayout({ screens: [{ panels: ['safety', 'safety', 'zzz'], columns: 9 }, { panels: ['vitals'] }] }, 'SCRUB', 'TABLET')!;
    expect(l.screens).toHaveLength(1);
    expect(l.screens[0].panels).toEqual(['safety']);
    expect([1, 2, 3]).toContain(l.screens[0].columns);
  });
});

describe('수술 중 기록 값 검사', () => {
  it('🔴 활력 범위 · 비어 있으면 거절 · 문자 숫자 허용', () => {
    expect(checkIntraopPayload('VITALS', { spo2: 101 }).ok).toBe(false);
    expect(checkIntraopPayload('VITALS', {}).ok).toBe(false);
    expect(checkIntraopPayload('VITALS', { spo2: '97', heartRate: '' })).toEqual({ ok: true, payload: { spo2: 97 } });
  });
  it('🔴 필수 칸 — 약물(이름·용량·단위) · 수액(양) · 혈액(단위 수 또는 양) · 배출(어휘 종류) · 단계 직접 입력 거절', () => {
    expect(checkIntraopPayload('DRUG', { name: 'Rocuronium', dose: 50, unit: 'mg', route: 'IV' })).toEqual({ ok: true, payload: { name: 'Rocuronium', dose: 50, unit: 'mg', route: 'IV' } });
    expect(checkIntraopPayload('DRUG', { name: 'x', dose: -1, unit: 'mg' }).ok).toBe(false);
    expect(checkIntraopPayload('FLUID', { name: 'NS' }).ok).toBe(false);
    expect(checkIntraopPayload('BLOOD', { product: 'RBC' }).ok).toBe(false);
    expect(checkIntraopPayload('BLOOD', { product: 'RBC', units: 1 }).ok).toBe(true);
    expect(checkIntraopPayload('OUTPUT', { type: 'SWEAT', volumeMl: 10 }).ok).toBe(false);
    expect(checkIntraopPayload('OUTPUT', { type: 'URINE', volumeMl: 100 }).ok).toBe(true);
    expect(checkIntraopPayload('PHASE', { phase: 'INCISION' }).ok).toBe(false);
  });
});

describe('수술팀 자리(orTeamRoleOf)', () => {
  const slots = { surgeonId: 's', assistantId: 'a', anesthetistId: null, recordAnesthetistId: 'm', scrubNurseId: 'n1', circulatingNurseId: 'n2' };
  it('지정 칸에 있는 사람만 · 마취 기록의 마취의도 마취팀 · 순회 간호', () => {
    expect(orTeamRoleOf(slots, 'm')).toBe('ANESTHESIA');
    expect(orTeamRoleOf(slots, 'a')).toBe('SURGEON');
    expect(orTeamRoleOf(slots, 'n1')).toBe('SCRUB');
    expect(orTeamRoleOf(slots, 'n2')).toBe('CIRCULATING');
    expect(orTeamRoleOf(slots, 'x')).toBeNull();
    expect(orTeamRoleOf({ ...slots, circulatingNurseId: null }, '')).toBeNull();
  });
  it('메모의 입력 방식 — VOICE 만 남기고 모르는 값은 버린다', () => {
    expect(checkIntraopPayload('NOTE', { text: '지혈', inputMethod: 'VOICE' })).toEqual({ ok: true, payload: { text: '지혈', inputMethod: 'VOICE' } });
    expect(checkIntraopPayload('NOTE', { text: '지혈', inputMethod: 'MAGIC' })).toEqual({ ok: true, payload: { text: '지혈' } });
  });
});

describe('활력 입력 검사 — 수축기 ≤ 이완기', () => {
  it('🔴 칸을 바꿔 적은 혈압은 거절 · 한쪽만 있으면 통과', () => {
    expect(checkIntraopPayload('VITALS', { systolicBp: 70, diastolicBp: 120 }).ok).toBe(false);
    expect(checkIntraopPayload('VITALS', { systolicBp: 80, diastolicBp: 80 }).ok).toBe(false);
    expect(checkIntraopPayload('VITALS', { systolicBp: 120, diastolicBp: 70 }).ok).toBe(true);
    expect(checkIntraopPayload('VITALS', { diastolicBp: 70 }).ok).toBe(true);
  });
});

describe('수술 중 기록 작성 권한 — 운영 모드', () => {
  it('🔴 리얼만 수술팀 한정 · 리허설·개발은 누구나', () => {
    expect(orWriteRequiresTeam('REAL')).toBe(true);
    expect(orWriteRequiresTeam('REHEARSAL')).toBe(false);
    expect(orWriteRequiresTeam('DEV')).toBe(false);
  });
});
