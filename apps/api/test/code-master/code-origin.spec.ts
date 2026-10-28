import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C4-b/F4 — 원내 코드는 **고시 파일에 없는 것이 정상**이다.
 *
 * 🔴 C2(고시 반영)를 만들면서 내가 만든 위험: 미리보기가 "파일에 없는 살아 있는 코드 N건"을
 *    폐지 후보로 세는데, **원내 등록분이 거기 섞인다.** 사람이 그것을 보고 원내 항목을 지운다.
 *
 * 🔴 그리고 기존 209,000행을 일괄로 `HIRA` 라고 찍지 않았다 — **우리는 그 행들이 어디서 왔는지 모른다.**
 */
const SCHEMA = join(process.cwd(), 'prisma/schema.prisma');
const IMPORT = join(process.cwd(), 'src/modules/code-master/code-import.service.ts');
const MASTER = join(process.cwd(), 'src/modules/code-master/code-master.service.ts');

describe('코드 출처', () => {
  const schema = readFileSync(SCHEMA, 'utf8');
  const imp = readFileSync(IMPORT, 'utf8');
  const master = readFileSync(MASTER, 'utf8');

  it('세 코드 모델 모두 출처 자리를 갖는다', () => {
    expect((schema.match(/^\s+origin\s+String\?\s+@db\.VarChar\(10\)/gm) ?? []).length).toBe(3);
  });

  it('🔴 출처는 nullable 이다 — 기존 행을 일괄로 고시라고 찍지 않는다', () => {
    // 대조군: 기본값을 박아 두면 209,000행이 근거 없이 "고시"가 된다
    expect(schema).not.toMatch(/origin\s+String\s+@default\("HIRA"\)/);
    expect(schema).not.toMatch(/origin\s+String\?\s+@default/);
  });

  it('고시 반영이 건드린 행에는 HIRA 가 찍힌다(신설·갱신·새 버전 전부)', () => {
    // procedure upsert 의 create/update 양쪽 + diagnosis 2 + medication 2
    expect((imp.match(/origin: 'HIRA'/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('🔴 사람이 화면에서 만든 코드는 원내 등록으로 찍힌다', () => {
    expect((master.match(/origin: 'LOCAL'/g) ?? []).length).toBe(3);
  });

  it('🔴 미리보기가 원내 건수를 따로 세어 "폐지 후보로 읽지 말라"고 말한다', () => {
    expect(imp).toMatch(/localCount/);
    // 문장은 `serverMsg` 키 + 값(2026-09-15 I2 — 화면이 조립) — 건수는 localCount 가 채운다
    expect(imp).toMatch(/원내 등록 \{건수\}건.*폐지 후보로 읽지 마세요.*\{ 건수: localCount \}/s);
  });

  it('🔴 원내 건수가 0이면 그 문구를 그리지 않는다 — 늘 붙는 안내는 읽히지 않는다', () => {
    expect(imp).toMatch(/if \(localCount > 0\) \{/);
  });

  it("출처 필터의 'UNKNOWN' 은 표기 없음(null)이지 별도 문자열이 아니다", () => {
    expect(master).toMatch(/origin === 'UNKNOWN' \? \{ origin: null \}/);
  });

  it('🔴 고시 반영은 여전히 아무것도 자동으로 폐지하지 않는다', () => {
    expect(imp).toMatch(/자동으로 폐지하지 않습니다/);
    expect(imp).toMatch(/retired: 0/);
  });
});
