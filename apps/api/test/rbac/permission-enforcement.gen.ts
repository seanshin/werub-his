import * as fs from 'fs';
import * as path from 'path';
import { scanEnforcement, EnforcementEntry } from './permission-enforcement.scan';

/**
 * 집행 대조표 **생성기** — 🔴 손으로 적지 않는다.
 * `permission-enforcement.spec.ts` 가 소스를 다시 스캔해 체크인된 정본과 비교하고,
 * **집행 등급(mode)이 어긋나면 실패**시킨다.
 * 갱신: `UPDATE_ENFORCEMENT_MAP=1 npx vitest run test/rbac` (apps/api)
 *
 * 줄번호는 담지 않는다 — 다른 모듈이 한 줄만 밀려도 깨져서, 정작 중요한
 * "집행되는가"라는 사실을 가리게 되기 때문(표는 사실을 말해야지 잡음을 내면 안 된다).
 */
export const SRC_ROOT = path.resolve(__dirname, '../../src');
export const MAP_PATH = path.resolve(SRC_ROOT, 'modules/rbac-admin/permission-enforcement.map.ts');

export interface Summary { mode: string; count: number; files: string[] }

export function summarize(scan: Record<string, EnforcementEntry>): Record<string, Summary> {
  const out: Record<string, Summary> = {};
  for (const [key, e] of Object.entries(scan)) {
    out[key] = { mode: e.mode, count: e.points.length, files: [...new Set(e.points.map((p) => p.file))].sort() };
  }
  return out;
}

export function renderMap(s: Record<string, Summary>): string {
  const L: string[] = [];
  L.push(`/**`);
  L.push(` * 권한 → **실제 집행점** 대조표 — 🔴 자동 생성(손으로 적지 않는다).`);
  L.push(` *`);
  L.push(` * 갱신: \`UPDATE_ENFORCEMENT_MAP=1 npx vitest run test/rbac\` (apps/api)`);
  L.push(` * 검증: \`test/rbac/permission-enforcement.spec.ts\` 가 소스를 재스캔해 mode 를 대조한다.`);
  L.push(` *`);
  L.push(` * 🔴 원 결함(W8/A1): 역할×권한 매트릭스가 실제 가드와 어긋난 채, 화면은 그 사실을 말하지`);
  L.push(` *    않고 토글만 보여줬다 — **켜도 꺼도 아무 API 도 달라지지 않는 권한**이 섞여 있었다.`);
  L.push(` *    권한 관리 화면이 자기 자신에 대해 P17(근거 없이 안심시킴)을 저지른 셈이다.`);
  L.push(` *    \`/admin/rbac\` 는 이 표를 그대로 읽어 "이 항목은 집행되지 않습니다"를 말한다.`);
  L.push(` *`);
  L.push(` * mode:`);
  L.push(` *  - matrix      : \`@RequirePermission\`/\`hasPermission\` — 이 매트릭스가 실제 판정에 쓰인다`);
  L.push(` *  - other-guard : 다른 가드가 판정한다(CredentialGuard=ADMIN∪per-user grant∪기능접근 매트릭스)`);
  L.push(` *                  → **이 화면의 토글은 무효**`);
  L.push(` *  - none        : 집행점 없음 — 토글해도 달라지는 API 가 없다`);
  L.push(` */`);
  L.push(`export type EnforcementMode = 'matrix' | 'other-guard' | 'none';`);
  L.push(``);
  L.push(`export interface EnforcementEntry {`);
  L.push(`  mode: EnforcementMode;`);
  L.push(`  /** 집행점 개수(데코레이터/검사 호출 수) */`);
  L.push(`  count: number;`);
  L.push(`  /** 집행점이 있는 파일(apps/api/src 기준) */`);
  L.push(`  files: string[];`);
  L.push(`}`);
  L.push(``);
  L.push(`export const PERMISSION_ENFORCEMENT: Record<string, EnforcementEntry> = {`);
  for (const [key, e] of Object.entries(s)) {
    const files = e.files.length ? `[${e.files.map((f) => `'${f}'`).join(', ')}]` : '[]';
    L.push(`  '${key}': { mode: '${e.mode}', count: ${e.count}, files: ${files} },`);
  }
  L.push(`};`);
  L.push(``);
  L.push(`/** 이 매트릭스가 판정하지 않는 권한(토글 무효) — 화면이 그대로 표기한다 */`);
  L.push(`export function ineffectivePermissions(): string[] {`);
  L.push(`  return Object.entries(PERMISSION_ENFORCEMENT).filter(([, e]) => e.mode !== 'matrix').map(([k]) => k);`);
  L.push(`}`);
  L.push(``);
  return L.join('\n');
}

export function writeMap(): Record<string, Summary> {
  const s = summarize(scanEnforcement(SRC_ROOT));
  fs.writeFileSync(MAP_PATH, renderMap(s));
  return s;
}

if (require.main === module) {
  const s = writeMap();
  const counts = Object.values(s).reduce<Record<string, number>>((a, e) => ({ ...a, [e.mode]: (a[e.mode] ?? 0) + 1 }), {});
  console.log('generated', MAP_PATH, counts);
}
