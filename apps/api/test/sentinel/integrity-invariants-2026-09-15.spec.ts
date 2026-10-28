/**
 * 2026-09-15 추가 불변식 67~70 — 정본 규칙을 SQL 로 옮긴 모양이 유지되는지(픽스처 DB 없이 문장 가드).
 * 운영 읽기 전용 실행으로 75행 전부 평가·새 4행 0건 확인(09-15).
 * 지키는 것: ① 네 항목이 심각도·코드로 존재하고 감시자 파서·소관 매핑에 걸린다
 *           ② 67 은 정본 AFFECTED 만 센다 — 판정 불명(시간표 밖·종일 세션+반일 휴진)과 지난 날 잔존을 세지 않는다
 *           ③ 69 는 전이 시각 컬럼이 있는 행만(소급 금지) ④ 70 은 폐기 시각 이후 연결만
 *           ⑤ 채택하지 않은 위급값 PENDING 장기 잔존은 SQL 에 없다(허용시간 미설정이면 0 이 "판정 안 함"을 가린다)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIntegrityRows, toFullScanSql } from '../../src/sentinel/integrity-sweep';
import { DATA_AUDIENCE } from '../../src/sentinel/sentinel-audience';

const REPO_ROOT = join(process.cwd(), '..', '..');
const sql = readFileSync(join(REPO_ROOT, 'infra/scripts/data-integrity-scan.sql'), 'utf-8');

/** `SELECT '<sev>', '<code> ...'` 부터 다음 `UNION ALL` 또는 CTE 닫힘 전까지 */
function block(code: string): string {
  const i = sql.search(new RegExp(`SELECT '(🔴|🟡|⚪)', '${code} `));
  if (i < 0) return '';
  const rest = sql.slice(i);
  const end = rest.search(/\nUNION ALL\n|\n\)\nSELECT sev/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('정합성 불변식 67~70 (2026-09-15)', () => {
  it('① 네 항목이 존재하고 감시자 파서·소관 매핑에 걸린다', () => {
    const expected = { '67': 'RED', '68': 'AMBER', '69': 'AMBER', '70': 'RED' } as const;
    for (const [code, sev] of Object.entries(expected)) {
      const b = block(code);
      expect(b, `${code} 항목을 찾지 못했다`).not.toBe('');
      const m = /SELECT '(\S+)', '([^']+)'/.exec(b)!;
      const [row] = parseIntegrityRows([{ sev: m[1], chk: m[2], n: 0 }]);
      expect(row.key).toBe(`integrity.${code}`);
      expect(row.severity).toBe(sev);
      expect(DATA_AUDIENCE[row.key], `${code} 소관 미지정`).toBeTruthy();
    }
    expect(() => toFullScanSql(sql)).not.toThrow();
  });

  it('② 67 은 정본 AFFECTED 만 — 종일 휴진 또는 같은 period 세션 안, 오늘(KST) 이후', () => {
    const b = block('67');
    expect(b).toMatch(/c\.period IS NULL OR c\.period = 'ALL'/);
    expect(b).toMatch(/s\.period = c\.period/);
    expect(b, '세션 소속은 시작 이상·끝 이하').toMatch(/>= \(\(c\.date \+ s\.start_time::time\)[\s\S]*<= \(\(c\.date \+ s\.end_time::time\)/);
    expect(b).toMatch(/>= \(now\(\) AT TIME ZONE 'Asia\/Seoul'\)::date/);
    expect(b, '종일 세션+반일 휴진(NEEDS_REVIEW)을 세면 판정 불명을 결함으로 부른다').not.toMatch(/s\.period = 'ALL'/);
    expect(b).toMatch(/NOT IN \('CANCELLED', 'NO_SHOW', 'COMPLETED'\)/);
  });

  it('③ 69 는 전이 시각 컬럼이 있는 행만 센다(09-14 이전 행 소급 금지)', () => {
    expect(block('69')).toMatch(/status_changed_at IS NOT NULL/);
  });

  it('④ 70 은 폐기 시각 이후 연결만 센다', () => {
    expect(block('70')).toMatch(/spu\.added_at > u\.retired_at/);
  });

  it('⑤ 위급값 PENDING 장기 잔존은 불변식으로 두지 않는다(기준 미설정 시 0 이 "판정 안 함"을 가린다)', () => {
    expect(sql).not.toMatch(/critical_value_alerts[\s\S]{0,200}status = 'PENDING'/);
  });
});
