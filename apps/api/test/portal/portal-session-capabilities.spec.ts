/**
 * 포털 세션 능력표 ↔ 서버 가드 기계 대조(2026-10-19 포털 세련화 A1).
 *  · 🔴 v4.93.0~2: 화면이 계정 전용 기능을 불러 보고 실패로 알았다 → 401/403 을 "세션 만료"로 읽어 로그아웃·거짓 문구(신고 3건)
 *  · 정본 shared `portal-session.ts` — 계정 가드(`PatientAccountAuthGuard`) 뒤 EP 는 전부 어느 기능에 속하고,
 *    기능마다 계정 가드 EP 가 실제로 있으며, 계정 없이 쓰는 EP(로그인·가입)는 어느 기능에도 속하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PORTAL_ACCOUNT_FEATURES, PORTAL_ACCOUNT_FEATURE_KEYS, portalAccountFeatureOfPath, portalAccountFeatures } from '@hospital-run/shared';
import { PortalController } from '../../src/modules/portal/portal.controller';

type Route = { path: string; account: boolean };
function routes(file: string): Route[] {
  const s = readFileSync(file, 'utf8');
  const out: Route[] = [];
  // 클래스마다 데코레이터 묶음(@UseGuards·@Controller)과 본문을 읽는다(한 파일에 컨트롤러가 둘인 경우 포함)
  const heads = [...s.matchAll(/((?:^@[^\n]*\n)+)export class/gm)];
  heads.forEach((h, i) => {
    const head = h[1];
    const ctrl = /@Controller\('([^']*)'\)/.exec(head);
    if (!ctrl) return;
    const body = s.slice(h.index! + h[0].length, heads[i + 1]?.index ?? s.length);
    const classAccount = /@UseGuards\([^)]*PatientAccountAuthGuard/.test(head);
    for (const b of body.split(/\n(?=  @(?:Get|Post|Put|Patch|Delete)\()/).slice(1)) {
      const m = /^  @(?:Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/.exec(b);
      if (!m) continue;
      const deco = b.slice(0, b.indexOf('async '));
      const account = classAccount || /PatientAccountAuthGuard/.test(deco);
      out.push({ path: `/${ctrl[1]}${m[1] ? `/${m[1]}` : ''}`, account });
    }
  });
  return out;
}
const ALL = [
  'src/modules/patient-auth/patient-auth.controller.ts',
  'src/modules/patient-auth/patient-profile.controller.ts',
  'src/modules/mobile/push-token.controller.ts',
].flatMap(routes);
const ACCOUNT = ALL.filter((r) => r.account);

describe('🔴 정본 ↔ 서버 가드', () => {
  it('계정 가드 뒤 EP 는 전부 어느 기능에 속한다', () => {
    expect(ACCOUNT.length).toBeGreaterThan(20); // 대조군 — 실제로 읽었다
    const orphan = ACCOUNT.filter((r) => portalAccountFeatureOfPath(r.path) == null).map((r) => r.path);
    expect(orphan).toEqual([]);
  });
  it('기능마다 계정 가드 EP 가 실제로 있다(지어낸 기능 없음)', () => {
    for (const k of PORTAL_ACCOUNT_FEATURE_KEYS) {
      expect(ACCOUNT.some((r) => portalAccountFeatureOfPath(r.path) === k), k).toBe(true);
    }
  });
  it('계정 없이 쓰는 EP(로그인·가입·갱신·직원 푸시)는 어느 기능에도 속하지 않는다', () => {
    const open = ALL.filter((r) => !r.account && r.path.startsWith('/api/v1/patient-auth') || r.path.includes('/staff/'));
    expect(open.length).toBeGreaterThan(5);
    expect(open.filter((r) => portalAccountFeatureOfPath(r.path) != null).map((r) => r.path)).toEqual([]);
  });
  it('가장 긴 접두사 — family ≠ family-accounts', () => {
    expect(portalAccountFeatureOfPath('/api/v1/patient-auth/profile/family-accounts/x/switch')).toBe('familyAccounts');
    expect(portalAccountFeatureOfPath('/api/v1/patient-auth/profile/family/1')).toBe('family');
    expect(PORTAL_ACCOUNT_FEATURES.family[0]).toBe('/api/v1/patient-auth/profile/family');
  });
});

describe('GET portal/session', () => {
  const ctrl = Object.create(PortalController.prototype) as PortalController;
  (ctrl as any).svc = { isInpatientLifeEnabled: async () => false, getOnboardingState: async (id: string | null) => (id ? { scope: 'ACCOUNT', completedAt: null } : { scope: 'DEVICE', completedAt: null }) };
  const tok = (exp: number) => `Bearer h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
  it('계정 세션 → ACCOUNT · 기능 전부 true · 만료 시각', async () => {
    const r = await ctrl.getSession({ patientAccountId: 'a1', headers: { authorization: tok(2_000_000_000) } } as any);
    expect(r.data.kind).toBe('ACCOUNT');
    expect(Object.values(r.data.features).every(Boolean)).toBe(true);
    expect(r.data.expiresAt).toBe(new Date(2_000_000_000 * 1000).toISOString());
    expect(r.data.onboarding).toEqual({ scope: 'ACCOUNT', completedAt: null });
  });
  it('🔴 등록번호 세션 → MRN · 보호자 → GUARDIAN · 계정 전용 기능 전부 false · 모르는 만료는 null', async () => {
    const mrn = await ctrl.getSession({ headers: { authorization: 'Bearer garbage' } } as any);
    // 계정 없는 세션 → 첫 안내는 기기 몫(DEVICE · 2026-10-20)
    expect(mrn.data).toEqual({ kind: 'MRN', features: portalAccountFeatures('MRN'), expiresAt: null, services: { inpatientLife: false }, onboarding: { scope: 'DEVICE', completedAt: null } });
    expect(Object.values(mrn.data.features).some(Boolean)).toBe(false);
    const g = await ctrl.getSession({ isGuardianAccess: true, patientAccountId: 'a1', headers: {} } as any);
    expect(g.data.kind).toBe('GUARDIAN');
    // 보호자 위임(포털 JWT) — 보는 사람 = 보호자 계정으로 첫 안내를 가른다
    const g2 = await ctrl.getSession({ isGuardianAccess: true, guardianAccountId: 'g1', headers: {} } as any);
    expect(g2.data.onboarding.scope).toBe('ACCOUNT');
  });
});

describe('설정으로 꺼진 포털 기능 — 능력표에 싣는다', () => {
  it('portal.inpatientLife 값 그대로 · 대조군 켜짐', async () => {
    for (const on of [false, true]) {
      const c = Object.create(PortalController.prototype) as any;
      c.svc = { isInpatientLifeEnabled: async () => on, getOnboardingState: async () => ({ scope: 'DEVICE', completedAt: null }) };
      expect((await c.getSession({ patientAccountId: 'a', headers: {} })).data.services).toEqual({ inpatientLife: on });
    }
  });
});
