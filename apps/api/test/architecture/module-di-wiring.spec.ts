import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **타입 0 · 테스트 초록 · nest build 성공이 배포 가능을 보장하지 않는다.**
 *
 * 2026-08-26 실운영 사고: `CodeMasterService` 에 `CodeUsageService` 를 주입했는데
 * 모듈 `providers` 에 등록하지 않아 **부팅이 실패했다**(502 · 로그인 전건 실패).
 * tsc·9,482 테스트·`nest build` 모두 통과했다 — 단위 테스트는 서비스를 직접 생성하므로
 * DI 배선을 검사하지 못한다. 이 저장소가 이미 겪은 층이다(v4.5.0 "next build 만 잡는 층").
 *
 * 이 가드는 **같은 모듈 폴더 안의 서비스**가 주입됐는데 `providers` 에 없는 경우를 잡는다.
 */
const MODULES_DIR = join(process.cwd(), 'src/modules');

function moduleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...moduleFiles(p));
    else if (name.endsWith('.module.ts')) out.push(p);
  }
  return out;
}

describe('모듈 DI 배선 — 주입한 것은 등록돼 있다', () => {
  const mods = moduleFiles(MODULES_DIR);

  it('스캐너가 실제로 모듈을 찾고 있다(0건을 통과로 읽지 않는다)', () => {
    expect(mods.length).toBeGreaterThan(50);
  });

  it('🔴 같은 폴더의 서비스를 주입했다면 providers 에 있다', () => {
    const bad: string[] = [];
    for (const modPath of mods) {
      const dir = join(modPath, '..');
      // 이 모듈 폴더의 *.service.ts 들
      let services: string[] = [];
      try {
        services = readdirSync(dir).filter((f) => f.endsWith('.service.ts'));
      } catch { continue; }
      // 🔴 한 폴더에 모듈 파일이 여럿일 수 있다(vitals.module + vitals-ingest.module).
      //    한 모듈만 보고 판정하면 **오탐**이 난다 — 첫 판에 실제로 그랬다.
      //    폴더 안 모든 모듈의 providers 를 합쳐서 본다.
      const siblingModules = readdirSync(dir).filter((f) => f.endsWith('.module.ts'));
      const providersBlock = siblingModules
        .map((f) => /providers:\s*\[([\s\S]*?)\]/.exec(readFileSync(join(dir, f), 'utf8'))?.[1] ?? '')
        .join(',');
      for (const f of services) {
        const src = readFileSync(join(dir, f), 'utf8');
        const cls = /export class (\w+Service)/.exec(src)?.[1];
        if (!cls) continue;
        // 이 폴더의 다른 파일이 생성자에 주입하는가
        const injected = services.some((other) => {
          if (other === f) return false;
          const o = readFileSync(join(dir, other), 'utf8');
          const ctor = /constructor\(([\s\S]*?)\)\s*\{/.exec(o)?.[1] ?? '';
          return new RegExp(`:\\s*${cls}\\b`).test(ctor);
        });
        if (injected && !providersBlock.includes(cls)) {
          bad.push(`${modPath.split('/src/')[1]} → ${cls} 주입됐는데 providers 에 없다`);
        }
      }
    }
    expect(bad, `DI 배선 누락:\n${bad.join('\n')}`).toEqual([]);
  });
});
