import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { scanEnforcement, readPermissionConstants } from './permission-enforcement.scan';
import { summarize, renderMap, writeMap, SRC_ROOT, MAP_PATH } from './permission-enforcement.gen';
import { PERMISSION_ENFORCEMENT } from '../../src/modules/rbac-admin/permission-enforcement.map';

/**
 * 🔴 W8/A1 — 권한 매트릭스 화면이 자기 자신에 대해 거짓말하지 못하게 붙잡는다.
 *
 * 원 결함: `/admin/rbac` 는 55개 권한을 전부 똑같은 토글로 보여줬지만, 그중 21개는
 *   켜도 꺼도 아무 API 도 달라지지 않았다(다른 가드가 판정하거나 집행점이 아예 없음).
 *   화면이 "통제되고 있다"고 믿게 만든 것 — P17(근거 없이 안심시킴).
 *
 * 그래서 집행 여부를 **손으로 적지 않고** 소스에서 스캔해 정본으로 굳히고, 여기서 대조한다.
 * 갱신: `UPDATE_ENFORCEMENT_MAP=1 npx vitest run test/rbac` (apps/api)
 */
describe('권한 집행 대조표 (permission-enforcement.map)', () => {
  const scanned = summarize(scanEnforcement(SRC_ROOT));

  if (process.env.UPDATE_ENFORCEMENT_MAP === '1') {
    it('정본을 재생성한다 (UPDATE_ENFORCEMENT_MAP=1)', () => {
      writeMap();
      expect(fs.readFileSync(MAP_PATH, 'utf8')).toBe(renderMap(scanned));
    });
    return;
  }

  it('Permission enum 의 모든 값이 대조표에 있다 (신설 권한 누락 차단)', () => {
    const values = readPermissionConstants(SRC_ROOT).map((p) => p.value);
    expect(Object.keys(PERMISSION_ENFORCEMENT).sort()).toEqual([...values].sort());
  });

  it('집행 등급(mode)이 소스 실측과 일치한다 — 어긋나면 표가 낡은 것', () => {
    const fromMap = Object.fromEntries(Object.entries(PERMISSION_ENFORCEMENT).map(([k, v]) => [k, v.mode]));
    const fromScan = Object.fromEntries(Object.entries(scanned).map(([k, v]) => [k, v.mode]));
    expect(fromMap).toEqual(fromScan);
  });

  it('🔴 집행되는 권한이 조용히 미집행으로 떨어지지 않는다 (기준선 동결)', () => {
    // 기준선 = 2026-08-14 실측. **줄어들면** 어딘가의 가드가 사라진 것이므로 실패시킨다.
    const enforced = Object.values(PERMISSION_ENFORCEMENT).filter((e) => e.mode === 'matrix').length;
    expect(enforced).toBeGreaterThanOrEqual(34);
  });

  it('🔴 미집행 권한이 늘어나지 않는다 (새 권한을 집행점 없이 추가하는 것을 막는다)', () => {
    const ineffective = Object.entries(PERMISSION_ENFORCEMENT).filter(([, e]) => e.mode !== 'matrix').map(([k]) => k);
    // 기준선 21건 — 넘어서면 "화면에만 있는 권한"을 또 만든 것이다.
    expect(ineffective.length).toBeLessThanOrEqual(21);
  });

  it('cred:* 6종은 CredentialGuard(other-guard) 가 판정한다 — 매트릭스 토글이 아니다', () => {
    const cred = Object.entries(PERMISSION_ENFORCEMENT).filter(([k]) => k.startsWith('cred:'));
    expect(cred.length).toBe(6);
    for (const [key, e] of cred) expect(`${key}=${e.mode}`).toBe(`${key}=other-guard`);
  });

  it('sign 원장 쓰기(reconcile)는 읽기 권한 AUDIT_VIEW 로 열리지 않는다', () => {
    const src = fs.readFileSync(`${SRC_ROOT}/modules/order-sign-log/order-sign-log.controller.ts`, 'utf8');
    const reconcile = src.slice(src.indexOf("@Post('order-sign-logs/reconcile')"));
    const decorator = reconcile.slice(0, reconcile.indexOf('async '));
    expect(decorator).toContain('Permission.SYSTEM_MANAGE');
    expect(decorator).not.toContain('Permission.AUDIT_VIEW');
  });
});
