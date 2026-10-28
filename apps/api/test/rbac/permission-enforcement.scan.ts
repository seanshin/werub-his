import * as fs from 'fs';
import * as path from 'path';

/**
 * 권한 상수 ↔ 실제 집행점 **기계 대조**.
 *
 * 🔴 원 결함(W8/A1): 역할×권한 매트릭스가 실제 가드와 양방향으로 어긋나 있었다.
 *    55개 권한 중 다수는 화면에서 켜고 꺼도 아무 일이 일어나지 않는데(집행점 없음),
 *    화면은 그 사실을 말하지 않고 초록/회색 토글만 보여줬다 — **권한 관리 화면이
 *    자기 자신에 대해 P17(근거 없이 안심시킴)을 저지른 것**.
 *
 * 그래서 "어느 권한이 실제로 집행되는가"를 **손으로 적지 않고 소스에서 스캔**한다.
 * 결과는 `/admin/rbac` 매트릭스가 그대로 표시한다(집행 O / 매트릭스 무효 / 집행점 없음).
 *
 * 집행 등급(mode):
 *  - `matrix`      : `@RequirePermission` / `PermissionService.hasPermission()` 로 집행 —
 *                    **이 매트릭스(역할 기본값 + 오버라이드)가 실제로 판정에 쓰인다**.
 *  - `other-guard` : `@RequireCred` 등 **다른 가드**가 집행 — 그 가드가 ROLE_PERMISSIONS 를
 *                    읽지 않으므로 이 화면의 토글은 무효다(CredentialGuard =
 *                    ADMIN 또는 per-user grant 또는 기능접근 매트릭스로 판정).
 *  - `none`        : 집행점이 하나도 없다 — 토글해도 달라지는 API 가 없다.
 */
export type EnforcementMode = 'matrix' | 'other-guard' | 'none';

export interface EnforcementPoint {
  /** RequirePermission | RequireCred | hasPermission */
  via: string;
  /** apps/api/src 기준 상대경로 */
  file: string;
  line: number;
}

export interface EnforcementEntry {
  mode: EnforcementMode;
  points: EnforcementPoint[];
}

/** 집행점으로 인정하는 표현 — 여기 없는 등장(타입 참조·시드 등)은 집행이 아니다 */
const MATRIX_VIA: readonly string[] = ['RequirePermission', 'hasPermission'];
const OTHER_GUARD_VIA: readonly string[] = ['RequireCred'];

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listTsFiles(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** `Permission` enum 을 소스에서 직접 읽는다(enum 값·누락까지 그대로 반영) */
export function readPermissionConstants(srcRoot: string): { name: string; value: string }[] {
  const src = fs.readFileSync(path.join(srcRoot, 'modules/auth/rbac/permission.types.ts'), 'utf8');
  const body = src.slice(src.indexOf('export enum Permission'), src.indexOf('export const ROLE_PERMISSIONS'));
  return [...body.matchAll(/^\s{2}([A-Z0-9_]+)\s*=\s*'([^']+)'/gm)].map((m) => ({ name: m[1], value: m[2] }));
}

/** 소스 전체를 훑어 권한별 집행점을 모은다 */
export function scanEnforcement(srcRoot: string): Record<string, EnforcementEntry> {
  const perms = readPermissionConstants(srcRoot);
  const result: Record<string, EnforcementEntry> = {};
  for (const p of perms) result[p.value] = { mode: 'none', points: [] };

  const skip = ['modules/auth/rbac/permission.types.ts', 'modules/auth/rbac/permission-catalog.ts'];
  for (const file of listTsFiles(srcRoot)) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/');
    if (skip.includes(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      let via: string | null = null;
      if (/@RequirePermission\(/.test(line)) via = 'RequirePermission';
      else if (/@RequireCred\(/.test(line)) via = 'RequireCred';
      else if (/hasPermission|hasAnyPermission|hasAllPermissions/.test(line)) via = 'hasPermission';
      if (!via) return;
      for (const p of perms) {
        if (!new RegExp(`\\bPermission\\.${p.name}\\b`).test(line)) continue;
        result[p.value].points.push({ via, file: rel, line: i + 1 });
      }
    });
  }

  for (const entry of Object.values(result)) {
    if (entry.points.some((pt) => MATRIX_VIA.includes(pt.via))) entry.mode = 'matrix';
    else if (entry.points.some((pt) => OTHER_GUARD_VIA.includes(pt.via))) entry.mode = 'other-guard';
    else entry.mode = 'none';
    entry.points.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  }
  return result;
}
