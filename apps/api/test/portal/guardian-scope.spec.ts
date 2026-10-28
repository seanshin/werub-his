import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GUARDIAN_SCOPE_KEYS, DEFAULT_GUARDIAN_SCOPE, BTG_GUARDIAN_SCOPE,
  GUARDIAN_SECTION_MAP, guardianDenies,
} from '../../src/modules/portal/guardian-scope';

/**
 * 보호자 위임 범위 — 2026-09-02.
 *
 * 🔴 게이트가 `scope['imaging'] === false` 로 막으려 했는데 **그 키를 만드는 생산자가 없었다.**
 *    `undefined === false` → 영상은 한 번도 막히지 않았고, 포털 화면은 참인 키만 나열하므로
 *    "열람 범위: 예약/진료/검사/수납"이라 그렸다 — **화면은 미위임을 말하고 서버는 DICOM 을 줬다.**
 */
describe('보호자 열람 범위 — 키가 없으면 열리지 않는다', () => {
  it('🔴 지도에 쓰이는 모든 구획에 기본값이 있다(생성되지 않는 키 금지)', () => {
    const mapped = [...new Set(GUARDIAN_SECTION_MAP.map((m) => m.section))];
    for (const sec of mapped) {
      expect(GUARDIAN_SCOPE_KEYS as readonly string[], `${sec} 가 키 목록에 없다`).toContain(sec);
      expect(DEFAULT_GUARDIAN_SCOPE, `일반 위임 기본값에 ${sec} 가 없다 — 게이트가 죽는다`).toHaveProperty(sec);
      expect(BTG_GUARDIAN_SCOPE, `BTG 기본값에 ${sec} 가 없다`).toHaveProperty(sec);
    }
  });

  it('🔴 fail-closed — 키가 빠진 낡은 토큰은 막힌다(예전엔 통과했다)', () => {
    const legacy = { appointments: true, encounters: true, labs: true, billing: true, documents: false };
    expect(guardianDenies(legacy, '/api/v1/portal/imaging/studies'), '영상이 열려 있으면 안 된다').toBe(true);
    expect(guardianDenies(legacy, '/api/v1/portal/imaging/report/1.2.3/pdf')).toBe(true);
    expect(guardianDenies(undefined, '/api/v1/portal/imaging/studies')).toBe(true);
  });

  it('허용된 구획은 그대로 통과한다 — 막는 가드만 만들지 않는다(대조군)', () => {
    expect(guardianDenies(DEFAULT_GUARDIAN_SCOPE, '/api/v1/portal/lab-results')).toBe(false);
    expect(guardianDenies(DEFAULT_GUARDIAN_SCOPE, '/api/v1/portal/imaging/studies')).toBe(false);
    expect(guardianDenies(DEFAULT_GUARDIAN_SCOPE, '/api/v1/portal/appointments')).toBe(false);
    // 지도에 없는 경로는 이 게이트 소관이 아니다(다른 게이트가 본다)
    expect(guardianDenies(DEFAULT_GUARDIAN_SCOPE, '/api/v1/portal/health-score')).toBe(false);
  });

  it('🔴 BTG(응급 임시 열람)는 영상·수납·문서를 잠근다', () => {
    expect(guardianDenies(BTG_GUARDIAN_SCOPE, '/api/v1/portal/imaging/studies')).toBe(true);
    expect(guardianDenies(BTG_GUARDIAN_SCOPE, '/api/v1/portal/billings')).toBe(true);
    expect(guardianDenies(BTG_GUARDIAN_SCOPE, '/api/v1/portal/documents')).toBe(true);
    expect(guardianDenies(BTG_GUARDIAN_SCOPE, '/api/v1/portal/lab-results'), '임상 조회는 열려야 한다').toBe(false);
  });

  it('🔴 URL→구획 지도가 하나다 — 가드가 각자 지도를 갖지 않는다', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const g of ['modules/patient-auth/guards/portal-or-patient.guard.ts', 'modules/portal/portal-auth.guard.ts']) {
      const src = read(g);
      expect(src, `${g} 가 자체 SECTION_MAP 을 갖고 있다 — W9 우회로가 한쪽에만 반영된다`).not.toMatch(/const SECTION_MAP/);
      expect(src, `${g} 가 정본 판정을 쓰지 않는다`).toMatch(/guardianDenies\(/);
      expect(src, `${g} 에 fail-open 비교가 남아 있다`).not.toMatch(/scope\[section\] === false/);
    }
  });
});
