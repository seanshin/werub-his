/**
 * 🔴 (2026-09-14) 포털 기본 공지가 CMS 가 비었을 때 근거 없는 시설 상수(주차 320대·한우리식당·메디치노·장례식장 02-1234-5670)를 환자에게 공지했다.
 * 지키는 것: 포털 서비스 소스에 그 상수가 없다(주석 제외).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('포털 기본 공지 — 지어낸 시설 사실 없음', () => {
  it('portal.service.ts 에 시설 상수가 없다', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/modules/portal/portal.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const lit of ['320대', '한우리', '메디치노', '02-1234-5670', '빈소 5실']) expect(src, lit).not.toContain(lit);
  });
});
