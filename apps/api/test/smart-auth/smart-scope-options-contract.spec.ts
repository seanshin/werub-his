import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SmartAuthService } from '../../src/modules/smart-auth/smart-auth.service';

/**
 * 🔴 r3 B8 — 관리 화면 SMART 스코프 선택지 8개가 비표준 표기라 권한으로 작동하지 않았다.
 *
 * FE 선택지(`apps/web/src/lib/smart-scopes.ts`)를 **서버 정본 `hasScope` 에 실제로 태운다** — 표기 규칙을 여기서
 * 다시 적으면 내 가정을 테스트하게 된다. 못박는 것:
 *   (a) 모든 선택지가 hasScope 로 최소 한 리소스·동작에 권한을 준다
 *   (b) system/* 은 선택지에 없다(어느 스코프를 열지는 사람 결정 H4 — 이 봉합은 표기만 고쳤다)
 *   (c) 대조군 — 종전 비표준 표기는 hasScope 가 인정하지 않는다(결함이 실재했다는 증거·가드 조준 확인)
 *   (d) 화면이 이 목록을 쓴다(지역 사본을 다시 두지 않는다)
 */

const WEB = join(__dirname, '../../../web/src');
const libSrc = readFileSync(join(WEB, 'lib/smart-scopes.ts'), 'utf8');
const block = libSrc.slice(libSrc.indexOf('SMART_SCOPE_OPTIONS = ['), libSrc.indexOf('] as const'));
const OPTIONS = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);

const hasScope = (scope: string, res: string, act: 'read' | 'write') =>
  SmartAuthService.prototype.hasScope.call({}, { scope } as never, res, act);

describe('SMART 스코프 선택지 ↔ 서버 hasScope', () => {
  it('선택지를 실제로 읽었다(하한)', () => {
    expect(OPTIONS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(OPTIONS)('(a) %s 는 권한으로 작동한다', (opt) => {
    const m = /^(patient|user|system)\/(\*|[A-Za-z]+)\.(read|write|\*)$/.exec(opt);
    expect(m, `표기 형식이 아니다: ${opt}`).not.toBeNull();
    const res = m![2] === '*' ? 'Patient' : m![2];
    const act = m![3] === 'write' ? 'write' : 'read';
    expect(hasScope(opt, res, act)).toBe(true);
  });

  it('(b) system/* 은 선택지에 없다(사람 결정 전 확장 금지)', () => {
    expect(OPTIONS.filter((o) => o.startsWith('system/'))).toEqual([]);
  });

  it('(c) 대조군 — 종전 비표준 표기는 서버가 인정하지 않는다', () => {
    for (const [old, res, act] of [
      ['encounter/*.read', 'Encounter', 'read'],
      ['medicationrequest/*.read', 'MedicationRequest', 'read'],
      ['observation/*.read', 'Observation', 'read'],
    ] as const) {
      expect(hasScope(old, res, act), old).toBe(false);
      expect(OPTIONS, `${old} 가 되살아났다`).not.toContain(old);
    }
  });

  it('(d) 관리 화면이 이 목록을 쓴다', () => {
    const page = readFileSync(join(WEB, 'app/(main)/admin/smart-clients/page.tsx'), 'utf8');
    expect(page).toMatch(/const AVAILABLE_SCOPES = SMART_SCOPE_OPTIONS;/);
    expect(page).not.toMatch(/'encounter\/\*\.read'/);
  });
});
