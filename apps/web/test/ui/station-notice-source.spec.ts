import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 미배선 안내 배너의 **데이터 출처** 계약 — 2026-08-12 (화면 점검 W1).
 *
 * 🔴 12화면에 배너를 일괄 삽입하다 `blood-bank` 만 `stationMeta` 를 **템플릿 응답(tplRes)** 에서
 *    가져갔다. 파일의 *첫 useQuery* 를 잡는 자동 삽입의 함정이다. 타입은 통과하고 화면도
 *    멀쩡해 보이는데 **배너만 영원히 안 뜬다** — 결함을 알리려고 만든 장치가 침묵했다.
 *
 * 규약: `stationMeta` 는 반드시 **station queue 응답**에서 온다.
 */

const WS = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'workstation');

describe('미배선 안내 배너', () => {
  it('🔴 stationMeta 는 station queue 응답에서 온다(다른 쿼리 응답 금지)', () => {
    const bad: string[] = [];

    for (const dir of fs.readdirSync(WS, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = path.join(WS, dir.name, 'page.tsx');
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, 'utf-8');
      if (!src.includes('StationConfigNotice')) continue;

      const m = src.match(/const stationMeta = \((\w+)\s/);
      if (!m) { bad.push(`${dir.name}: stationMeta 선언 없음`); continue; }
      const varName = m[1];

      // 그 변수를 담은 useQuery 가 station queue 를 부르는지
      const q = new RegExp(`const \\{ data: ${varName}[^}]*\\} = useQuery\\(\\{[\\s\\S]{0,400}?\\}\\);`);
      const block = src.match(q)?.[0] ?? '';
      // stationId 가 변수인 경우도 있다: `/workstation/station/${station}/queue`
      if (!/workstation\/station\/[^'`"]*\/queue/.test(block)) {
        bad.push(`${dir.name}: stationMeta 가 '${varName}'(큐 응답 아님)에서 온다`);
      }
    }

    expect(bad, `배너가 영원히 안 뜬다:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 배너를 flex/grid 컨테이너 안에 두지 않는다(컬럼을 차지해 본문이 밀린다)', () => {
    const bad: string[] = [];

    for (const dir of fs.readdirSync(WS, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = path.join(WS, dir.name, 'page.tsx');
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf-8').split('\n');

      lines.forEach((line, i) => {
        if (!line.includes('<StationConfigNotice')) return;
        // 배너 바로 앞의 여는 태그를 거슬러 찾는다
        for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
          const m = lines[j].match(/<div className="([^"]*)"[^>]*>\s*$/);
          if (!m) continue;
          if (/\b(flex|grid)\b/.test(m[1]) && !/flex-col/.test(m[1])) {
            bad.push(`${dir.name}:${i + 1} — 부모가 "${m[1]}"`);
          }
          break;
        }
      });
    }

    expect(bad, `배너가 레이아웃을 깨뜨린다:\n${bad.join('\n')}`).toEqual([]);
  });
});
