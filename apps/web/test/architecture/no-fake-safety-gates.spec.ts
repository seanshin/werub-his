import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { warnIf, anyWarn, abnormalOf, UNMEASURED_LABEL } from '../../src/lib/vital-flags';

/**
 * 2026-08-19 §10-b 회수분 가드.
 *
 * 🔴 규약: **체크리스트가 버튼을 막는다면 그 체크는 서버에 남아야 한다. 남길 곳이 없으면 막지도 않는다.**
 *    워크스테이션 10화면이 `useState` 뿐인 체크로 완료를 막고 있었다 — 안전은 0인데
 *    화면은 "확인하고 완료했다"고 말했고(P17), 표 행의 같은 mutation 버튼으로 우회됐다.
 *
 * 재주입하면 실패한다: 로컬 체크로 다시 막으면 곧바로 잡힌다.
 */
const WS = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'workstation');
const files = fs.readdirSync(WS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(WS, e.name, 'page.tsx'))
  .filter((f) => fs.existsSync(f));

describe('가짜 게이트 — 서버에 남지 않는 체크로 업무를 막지 않는다', () => {
  it('워크스테이션 화면을 실제로 스캔한다(분모 확인)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('🔴 로컬 체크리스트 상태가 disabled 조건에 쓰이지 않는다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // `disabled={... allChecked ...}` / `checklistDone < checklistTotal` / `allRequiredChecked`
      const bad = src.match(/disabled=\{[^}]*(allChecked|allRequiredChecked|checklistDone\s*<\s*checklistTotal)[^}]*\}/g);
      if (bad) offenders.push(`${path.basename(path.dirname(f))} → ${bad.join(' , ')}`);
    }
    expect(offenders, `가짜 게이트가 살아 있다:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('체크리스트를 그리는 화면은 그것이 기록이 아님을 밝힌다', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const hasChecklist = /CHECKLIST_ITEMS\s*\.map\(/.test(src);
      if (hasChecklist && !src.includes('LocalChecklistNotice')) missing.push(path.basename(path.dirname(f)));
    }
    expect(missing, `체크리스트가 무엇인지 밝히지 않는 화면:\n${missing.join(', ')}`).toEqual([]);
  });
});

describe('활력 3상 판정 — 미측정은 판정하지 않는다', () => {
  it('측정된 값만 판정하고, 미측정은 null 이다', () => {
    expect(warnIf(93, (v) => v < 94)).toBe(true);
    expect(warnIf(98, (v) => v < 94)).toBe(false);
    expect(warnIf(null, (v) => v < 94)).toBeNull();
    expect(warnIf(undefined, (v) => v < 94)).toBeNull();
    expect(warnIf('', (v) => v < 94)).toBeNull();
    expect(warnIf('abc', (v) => v < 94)).toBeNull(); // 숫자가 아니면 미측정
  });

  it('🔴 미측정을 0·정상으로 접지 않는다 — 그것이 경고를 조용히 없앤다', () => {
    // 종전 코드: (spo2 ?? 100) < 95 → 미측정이 "정상"
    expect(warnIf(null, (v) => v < 95)).not.toBe(false);
    // 종전 코드: (painScore ?? 0) >= 7 → 미측정이 "무통"
    expect(warnIf(null, (v) => v >= 7)).not.toBe(false);
  });

  it('하나라도 이상이면 이상, 전부 미측정이면 미측정', () => {
    expect(anyWarn(null, true, false)).toBe(true);
    expect(anyWarn(null, false)).toBe(false);
    expect(anyWarn(null, null)).toBeNull();
  });

  it('임계 정본은 서버다 — isAbnormal 이 있으면 그것을 쓴다', () => {
    expect(abnormalOf(true, null)).toBe(true);
    expect(abnormalOf(false, true)).toBe(false);
    expect(abnormalOf(undefined, true)).toBe(true);
    expect(abnormalOf(null, null)).toBeNull(); // 서버도 화면도 모르면 모른다
  });

  it('미측정 표기는 한 곳에서 온다', () => {
    expect(UNMEASURED_LABEL).toBe('미측정');
  });
});
