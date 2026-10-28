import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { genderText, genderCode } from '@hospital-run/shared';

/**
 * 성별 표기 정본 가드 — 2026-08-12 (화면 점검 W1 · 패턴 P1-ⓑ 친척).
 *
 * 🔴 `gender === 'MALE' ? '남' : '여'` 이진 삼항이 27파일에 퍼져 있었다. 이 형태는
 *    **값이 없을 때 반대 값으로 단정한다** — 대기열 API 가 `gender` 를 select 에서 빠뜨리자
 *    외래 간호 워크스테이션이 20행을 전부 여성으로 표시했다(실측). 아무도 몰랐다.
 *    성별은 간호 준비·검사 기준치·용량이 읽는 임상 값이다. **모르면 `-` 라고 말해야 한다.**
 */

const SRC = path.join(__dirname, '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('성별 표기', () => {
  it('모르는 값은 반대 성별로 단정하지 않는다', () => {
    expect(genderText('MALE')).toBe('남');
    expect(genderText('FEMALE')).toBe('여');
    expect(genderText(undefined)).toBe('-');
    expect(genderText(null)).toBe('-');
    expect(genderText('')).toBe('-');
  });

  it('🔴 OTHER·UNKNOWN 은 뭉개지 않고 라벨표대로 말한다(shared 정본의 강점)', () => {
    expect(genderText('OTHER')).toBe('기타');
    expect(genderText('UNKNOWN')).toBe('미상');
  });

  it('데이터 인코딩용 코드는 모르면 빈 문자열(거짓 코드 금지)', () => {
    expect(genderCode('MALE')).toBe('M');
    expect(genderCode('FEMALE')).toBe('F');
    expect(genderCode(undefined)).toBe('');
    expect(genderCode('OTHER')).toBe('');
  });

  it('🔴 화면 표시에 genderCode(M/F)를 쓰지 않는다 — 한글 화면에 영문이 뜬다', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const src = fs.readFileSync(f, 'utf-8');
      src.split('\n').forEach((line, i) => {
        if (!line.includes('genderCode(')) return;
        // QR·팔찌 등 데이터 인코딩은 허용 — JSON 필드로 들어가는 경우
        if (/qrData|JSON\.stringify|g:\s*genderCode|const \w+ = genderCode/.test(line)) return;
        bad.push(`${path.relative(SRC, f)}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    expect(bad, `표시에는 genderText 를 쓰세요:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 이진 삼항 `=== \'MALE\' ? … : …` 이 되살아나지 않는다', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      if (f.endsWith(path.join('components', 'ui', 'display.tsx'))) continue;
      const src = fs.readFileSync(f, 'utf-8');
      src.split('\n').forEach((line, i) => {
        // 표시용 이진 삼항만 잡는다(스타일 클래스 분기는 제외)
        if (/===\s*'MALE'\s*\?\s*'(남|M)'\s*:\s*'(여|F)'/.test(line)) {
          bad.push(`${path.relative(SRC, f)}:${i + 1}`);
        }
      });
    }
    expect(bad, `genderText/genderCode 를 쓰세요:\n${bad.join('\n')}`).toEqual([]);
  });
});
