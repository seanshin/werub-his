/**
 * 여정 P2 확장 — 상태–사건 대조(I5)를 응급 도착·입원·수술·PACU 로(2026-10-01 · `patient-journey-model.plan.md` §5.2 I5).
 *
 * 두 겹으로 지킨다:
 *  ① **코드 경로** — 그 상태를 만드는 메서드가 같은 메서드 안에서 그 사건을 발행한다(새 경로가 발행 없이 생기면 여기서 실패).
 *  ② **원장** — 감시자 82~85 가 경계 이후 "상태는 있는데 사건이 없는" 행을 센다(시드·스크립트·수동 SQL 처럼 코드 밖에서 생긴 것).
 *     경계 = shared `JOURNEY_REF_ATTACHED_SINCE`(발행이 원 기록 id 를 싣기 시작한 커밋 · git -S 로 확인) — SQL 과 기계 대조.
 *
 * 🔴 첫 운영 측정(읽기 전용): 입원 12/16 · 수술 종료 32/32 · PACU 퇴실 3/3 — **전부 시드**(시드 UUID·감사 기록 없음).
 *    코드 경로는 전부 발행했다(①이 통과). 데이터는 고치지 않는다(소급 없음) — 이 수가 늘면 그때가 신호다.
 * 재주입: 입원 생성 메서드에서 ADMISSION 발행을 지우면 ①이 실패한다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOURNEY_REF_ATTACHED_SINCE, JOURNEY_OBSERVED_SINCE } from '@hospital-run/shared';

const MODULES = join(__dirname, '../../src/modules');

/** 클래스 메서드 단위로 자른다(2칸 들여쓰기 메서드 선언 기준) — 발행은 상태 쓰기와 같은 메서드 안에 있어야 한다 */
export function methodsOf(src: string): { name: string; body: string }[] {
  const re = /^ {2}(?:(?:private|public|protected|static|readonly)\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/gm;
  const heads = [...src.matchAll(re)].filter((m) => !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1]));
  return heads.map((m, i) => ({ name: m[1], body: src.slice(m.index!, i + 1 < heads.length ? heads[i + 1].index! : src.length) }));
}

/** [상태 쓰기 모양, 그 쓰기가 만드는 사건] — 쓰기 모양은 메서드 본문에서 찾는다 */
const RULES: { label: string; write: RegExp; event: string }[] = [
  { label: '응급 방문 생성', write: /\.emergencyVisit\.create\(/, event: 'ER_ARRIVAL' },
  { label: '입원 생성', write: /\.admission\.create\(/, event: 'ADMISSION' },
  { label: '수술 시작', write: /\.surgery\.update\([\s\S]{0,200}startedAt:\s*new Date\(\)/, event: 'SURGERY_START' },
  { label: '수술 종료', write: /endedAt:\s*new Date\(\)[\s\S]{0,400}\.surgery\.update\(/, event: 'SURGERY_COMPLETE' },
  { label: 'PACU 입실', write: /\.pacuRecord\.create\(/, event: 'PACU_ADMISSION' },
  { label: 'PACU 퇴실', write: /\.pacuRecord\.updateMany\([\s\S]{0,300}dischargeTime:\s*now/, event: 'PACU_DISCHARGE' },
];

function violations(files: { path: string; src: string }[]) {
  const hits: { rule: string; at: string; ok: boolean }[] = [];
  for (const f of files) {
    const ms = methodsOf(f.src);
    const byName = new Map(ms.map((m) => [m.name, m.body]));
    for (const m of ms) {
      for (const r of RULES) {
        if (!r.write.test(m.body)) continue;
        const needle = `eventType: '${r.event}'`;
        // 같은 파일의 도우미 메서드로 한 단계 위임한 발행도 인정한다(예: 데모 응급 생성기 → emitDemoErJourney)
        const helpers = [...m.body.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)].map((x) => byName.get(x[1]) ?? '');
        hits.push({ rule: r.label, at: `${f.path}#${m.name}`, ok: m.body.includes(needle) || helpers.some((h) => h.includes(needle)) });
      }
    }
  }
  return hits;
}

function moduleFiles() {
  const out: { path: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push({ path: p.slice(MODULES.length + 1), src: readFileSync(p, 'utf8') });
    }
  };
  walk(MODULES);
  return out;
}

describe('① 코드 경로 — 상태를 만드는 메서드가 그 사건을 발행한다', () => {
  const hits = violations(moduleFiles());

  it('대조군 — 규칙마다 실제 쓰기 지점을 찾는다(0 이면 이 가드는 아무것도 지키지 않는다)', () => {
    for (const r of RULES) expect(hits.filter((h) => h.rule === r.label).length, r.label).toBeGreaterThan(0);
  });

  it('🔴 발행 없는 상태 쓰기가 없다', () => {
    expect(hits.filter((h) => !h.ok)).toEqual([]);
  });

  it('대조군 — 발행을 지운 메서드는 위반으로 잡힌다', () => {
    const src = `class X {\n  async admit() {\n    await tx.admission.create({ data: {} });\n  }\n  async other() {\n    this.journey.emit({ eventType: 'ADMISSION' });\n  }\n}\n`;
    expect(violations([{ path: 'x.ts', src }])).toEqual([{ rule: '입원 생성', at: 'x.ts#admit', ok: false }]);
  });

  it('대조군 — 같은 파일 도우미로 위임한 발행은 인정한다 · 도우미가 다른 사건이면 위반', () => {
    const ok = `class X {\n  async admit() {\n    await tx.admission.create({ data: {} });\n    this.emitIt();\n  }\n  private emitIt() {\n    this.journey.emit({ eventType: 'ADMISSION' });\n  }\n}\n`;
    expect(violations([{ path: 'x.ts', src: ok }]).filter((h) => h.at === 'x.ts#admit')).toEqual([{ rule: '입원 생성', at: 'x.ts#admit', ok: true }]);
    const bad = ok.replace("eventType: 'ADMISSION'", "eventType: 'DISCHARGE'");
    expect(violations([{ path: 'x.ts', src: bad }]).filter((h) => h.at === 'x.ts#admit')[0].ok).toBe(false);
  });
});

describe('② 감시자 82~85 — 경계 = shared 귀속 시작 등록부', () => {
  const sql = readFileSync(join(__dirname, '../../../../infra/scripts/data-integrity-scan.sql'), 'utf8');
  const seg = (n: string) => {
    const i = sql.indexOf(`'${n} 여정 원장`);
    expect(i, n).toBeGreaterThan(-1);
    return sql.slice(i, sql.indexOf('UNION ALL', i));
  };
  const cases: [string, string[]][] = [
    ['82', ['ER_ARRIVAL']],
    ['83', ['ADMISSION']],
    ['84', ['SURGERY_START', 'SURGERY_COMPLETE']],
    ['85', ['PACU_ADMISSION', 'PACU_DISCHARGE']],
  ];
  it.each(cases)('%s — 사건 유형과 경계 시각이 등록부와 같다', (n, types) => {
    const s = seg(n);
    for (const t of types) {
      const r = JOURNEY_REF_ATTACHED_SINCE[t as keyof typeof JOURNEY_REF_ATTACHED_SINCE];
      expect(r, t).toBeTruthy();
      expect(s).toContain(`e.event_type = '${t}'`);
      expect(s).toContain(`'${r!.since}'::timestamptz`);
      expect(r!.commit).toMatch(/^[0-9a-f]{9}$/);
      // 귀속 시작은 그 유형의 첫 발행보다 이르지 않다
      const first = JOURNEY_OBSERVED_SINCE[t as keyof typeof JOURNEY_OBSERVED_SINCE];
      expect(first && Date.parse(r!.since) >= Date.parse(first.since), t).toBe(true);
    }
  });
});

describe('예약 — 예정 시각은 발생과 섞지 않는다', () => {
  it('예약 접수 발행이 plannedAt 을 싣는다(검진 예약과 같은 규약)', () => {
    const src = readFileSync(join(MODULES, 'schedule/schedule.service.ts'), 'utf8');
    const i = src.indexOf("eventType: 'APPOINTMENT_BOOKED'");
    expect(src.slice(i, i + 300)).toMatch(/plannedAt:\s*scheduledAt/);
  });
});
