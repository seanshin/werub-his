import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🔴 외부 시스템 런처는 **기관 도메인으로 폴백하지 않는다**.
 *
 * 실측: `EduLauncher` 가 `edu.url` 미설정이면 코드에 박힌 `https://edu.example.org` 로
 * **staff-token(10분)을 URL 에 실어** 새 창을 열었다. 게다가 `edu.url`·`edu.enabled`·`edu.ssoPath` 가
 * 설정 DEFAULTS 에 없어서 `PUT /config/edu.url` 이 `category=general` 로 저장됐고,
 * 런처가 읽는 `?category=integration` 목록에는 끝내 나타나지 않았다 — **설정 화면으로 고칠 길이 없었다.**
 * 같은 종류의 자리를 하나 더 고친 직후다.
 *
 * 지킨다: ① 런처 소스에 외부 호스트 리터럴이 없다 ② 주소를 모르면 **버튼을 내지 않는다**.
 */
const LAYOUT = path.join(__dirname, '..', '..', 'src', 'components', 'layout');
const LAUNCHERS = ['EduLauncher.tsx', 'ErpLauncher.tsx'];

describe('외부 시스템 런처 — 기관 도메인을 코드에 두지 않는다', () => {
  it('대조군 — 런처 파일을 실제로 읽었다', () => {
    for (const f of LAUNCHERS) expect(fs.existsSync(path.join(LAYOUT, f)), `${f} 가 없다`).toBe(true);
  });

  it('🔴 외부 http(s) 호스트 리터럴이 없다', () => {
    for (const f of LAUNCHERS) {
      const src = fs.readFileSync(path.join(LAYOUT, f), 'utf8');
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // 주석은 서사다(왜 없앴는지 적혀 있다)
        .join('\n');
      const hits = [...code.matchAll(/['"`]https?:\/\/[^'"`]+['"`]/g)].map((m) => m[0]);
      expect(hits, `${f} 에 외부 주소가 박혀 있다: ${hits.join(' · ')}`).toEqual([]);
    }
  });

  it('🔴 주소를 모르면 런처를 내지 않는다(빈 문자열로 열지 않는다)', () => {
    const src = fs.readFileSync(path.join(LAYOUT, 'EduLauncher.tsx'), 'utf8');
    expect(src, 'edu.url 이 비었을 때의 분기가 없다').toMatch(/if\s*\(\s*!enabled\s*\|\|\s*!url\s*\)\s*return null/);
  });
});
