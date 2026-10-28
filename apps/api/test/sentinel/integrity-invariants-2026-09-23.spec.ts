/**
 * 2026-09-23 추가 불변식 72·72b — 진료 대화 전사 보존(VoiceEMR §13 D6). 픽스처 DB 없이 문장 가드.
 * 지키는 것: ① 두 항목이 심각도·코드로 존재하고 감시자 파서·소관·드릴다운에 걸린다
 *           ② 72 는 종료 상태만·보존명령(세션 legal_hold + 활성 legal_holds) 제외·기간은 설정 행에서만(수치를 박지 않는다)
 *           ③ 72b 는 설정 행이 없을 때만 센다 — 72 의 0 이 "평가 안 함"을 가리지 않게 한다
 *           ④ 두 행 모두 draft_snapshot 을 보지 않는다(파기 대상이 아니다)
 *           ⑤ SQL 의 종료 상태 집합이 파기 핸들러의 정본(SCRIBE_TERMINAL_STATUSES)과 같다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRITY_DRILLDOWN, parseIntegrityRows, toFullScanSql } from '../../src/sentinel/integrity-sweep';
import { DATA_AUDIENCE } from '../../src/sentinel/sentinel-audience';
import { SCRIBE_TERMINAL_STATUSES } from '../../src/modules/retention/retention.service';

const REPO_ROOT = join(process.cwd(), '..', '..');
const sql = readFileSync(join(REPO_ROOT, 'infra/scripts/data-integrity-scan.sql'), 'utf-8');

function block(code: string): string {
  const i = sql.search(new RegExp(`SELECT '(🔴|🟡|⚪)', '${code} `));
  if (i < 0) return '';
  const rest = sql.slice(i);
  const end = rest.search(/\nUNION ALL\n|\n\)\nSELECT sev|\n\n-- ══/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('정합성 불변식 72·72b (2026-09-23 전사 보존)', () => {
  it('① 두 항목이 존재하고 파서·소관·드릴다운(/admin/retention)에 걸린다', () => {
    const expected = { '72': 'AMBER', '72b': 'INFO' } as const;
    for (const [code, sev] of Object.entries(expected)) {
      const b = block(code);
      expect(b, `${code} 항목을 찾지 못했다`).not.toBe('');
      const m = /SELECT '(\S+)', '([^']+)'/.exec(b)!;
      const [row] = parseIntegrityRows([{ sev: m[1], chk: m[2], n: 0 }]);
      expect(row.key).toBe(`integrity.${code}`);
      expect(row.severity).toBe(sev);
      expect(DATA_AUDIENCE[row.key], `${code} 소관 미지정`).toBeTruthy();
      expect(INTEGRITY_DRILLDOWN[row.key]).toBe('/admin/retention');
    }
    expect(() => toFullScanSql(sql)).not.toThrow();
  });

  it('② 72 — 종료 상태만·보존명령 둘 다 제외·기간은 설정 행(scribe.transcript.retention)에서만', () => {
    const b = block('72');
    expect(b).toMatch(/s\.status IN \('APPLIED', 'FAILED', 'DELETED'\)/);
    expect(b, '미반영 대기(TRANSCRIBED·DRAFTED)는 세지 않는다').not.toMatch(/TRANSCRIBED|DRAFTED/);
    expect(b).toMatch(/s\.legal_hold = false/);
    expect(b).toMatch(/NOT EXISTS \(SELECT 1 FROM legal_holds h LEFT JOIN legal_hold_releases r ON r\.hold_id = h\.id/);
    expect(b).toMatch(/r\.id IS NULL/);
    expect(b).toMatch(/JOIN system_configs c ON c\.key = 'scribe\.transcript\.retention'/);
    expect(b).toMatch(/\(c\.value #>> '\{\}'\)::numeric \* interval '1 day'/);
    expect(b, '보존 일수를 SQL 에 박지 않는다(코드 기본값 90 도 정책이 아니다)').not.toMatch(/interval '(?!1 day)\d+ day/);
    expect(b).toMatch(/s\.transcript IS NOT NULL OR EXISTS \(SELECT 1 FROM voice_utterances u WHERE u\.session_id = s\.id\)/);
  });

  it('③ 72b — 설정 행이 없을 때만 센다(72 의 0 을 "판정 안 함"으로 읽지 않게)', () => {
    const b = block('72b');
    expect(b).toMatch(/NOT EXISTS \(SELECT 1 FROM system_configs c WHERE c\.key = 'scribe\.transcript\.retention'/);
    expect(b).toMatch(/s\.status IN \('APPLIED', 'FAILED', 'DELETED'\)/);
    expect(b, '기간이 없으니 시각 비교가 없어야 한다').not.toMatch(/updated_at </);
  });

  it('④ 두 행 모두 draft_snapshot 을 보지 않는다', () => {
    expect(block('72')).not.toMatch(/draft_snapshot/);
    expect(block('72b')).not.toMatch(/draft_snapshot/);
  });

  it('⑤ SQL 의 종료 상태 집합 = 파기 핸들러 정본', () => {
    const lit = `('${[...SCRIBE_TERMINAL_STATUSES].join("', '")}')`;
    expect(block('72')).toContain(`s.status IN ${lit}`);
    expect(block('72b')).toContain(`s.status IN ${lit}`);
  });
});

/*
 * 재주입(2026-09-23): 72 의 `AND s.legal_hold = false` 제거 → ② 실패 · 72b 의 NOT EXISTS 를 EXISTS 로 → ③ 실패 ·
 * 72 의 `interval '1 day'` 를 `interval '90 day'` 로 → ② 실패 · 72 에 `'TRANSCRIBED'` 추가 → ②·⑤ 실패
 */
