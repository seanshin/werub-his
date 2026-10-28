/**
 * 🔴 (2026-09-14) 여정 이벤트 어휘 ↔ 발행 지점 기계 대조.
 *
 * 정본이 셋(연동 가이드 표·위치 매핑·web 아이콘)이라 "처방 여정 미발행(실제로는 리스너 삼항으로 발행)"·
 * "담당의 변경 미발행(실제로는 TRANSFER_CARE)" 같은 거짓 잔여와, 반대로 위치 매핑·아이콘은 기다리는데
 * 발행 0 인 이름(ER_TREATMENT_START·ORDER_COMPLETED·BILLING_CREATED·CONSENT_REVOKED)이 동시에 있었다.
 *
 * 지키는 것:
 *  ① 발행 지점(journey.emit / patientJourneyEvent.create)의 모든 리터럴 eventType 이 shared JOURNEY_EVENT_TYPES 안에 있다
 *  ② JOURNEY_EVENT_TYPES 의 모든 유형이 발행 지점 ≥1 (시뮬레이터 제외)
 *  ③ JOURNEY_EVENT_NOT_EMITTED 는 목록 동결·사유 필수·어휘와 겹치지 않고 도메인 발행 0
 *  ④ 위치 매핑 키가 어휘 안에 있다 · 표시 정본(JOURNEY_EVENT_DISPLAY)이 어휘와 같은 집합 · web 탭은 정본을 쓴다
 *  ⑤ 스캐너 대조군 — 삼항·직접 create·동적 인자를 실제로 읽는다(0 이면 위 검사는 빈 검사)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOURNEY_EVENT_ALIASES, JOURNEY_EVENT_DISPLAY, JOURNEY_EVENT_NOT_EMITTED, JOURNEY_EVENT_TYPES } from '@hospital-run/shared';

const API_SRC = path.resolve(__dirname, '../../src');
const WEB_JOURNEY_TAB = path.resolve(__dirname, '../../../web/src/app/(main)/patients/[id]/components/JourneyTab.tsx');
const SIMULATOR = /modules[\\/]simulator[\\/]/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) acc.push(p);
  }
  return acc;
}

function callBody(src: string, from: number): string {
  let depth = 1;
  let j = from;
  while (depth > 0 && j < src.length) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') depth--;
    j++;
  }
  return src.slice(from, j);
}

export interface EmitSite { type: string; where: string; simulator: boolean }

/** 소스 문자열에서 발행 지점을 뽑는다 — 테스트 대조군이 같은 함수를 쓴다 */
export function scanJourneyEmits(src: string, rel: string): { sites: EmitSite[]; dynamic: string[] } {
  const sites: EmitSite[] = [];
  const dynamic: string[] = [];
  const simulator = SIMULATOR.test(rel);
  const re = /(journey\w*\??\.emit\(|patientJourneyEvent\.create\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = callBody(src, m.index + m[0].length);
    const line = src.slice(0, m.index).split('\n').length;
    const et = /eventType\s*:\s*([^,\n}]+)/.exec(body);
    // 🔴 (2026-09-14 병합 트리) 지역 변수를 거친 발행(`const eventType = a ? 'X' : 'Y'` → `{ eventType }` 단축·`eventType: eventType`)을
    //    못 읽어 A5 진단검사 3종이 "발행 0"으로 떨어졌다 — 같은 파일에서 호출 직전의 `const <이름> = …;` 리터럴을 따라간다.
    const shorthand = !et && /(?:^|[{,\s])eventType\s*[,}\n]/.test(body) ? 'eventType' : null;
    const ident = shorthand ?? (et && /^\s*([A-Za-z_$][\w$]*)\s*$/.test(et[1]) ? et[1].trim() : null);
    let expr = et ? et[1] : '';
    if (ident) {
      const before = src.slice(Math.max(0, m.index - 3000), m.index);
      const decls = [...before.matchAll(new RegExp(`(?:const|let)\\s+${ident}\\s*(?::[^=]+)?=\\s*([^;]+);`, 'g'))];
      if (decls.length) expr = decls[decls.length - 1][1];
    }
    if (!et && !shorthand) { dynamic.push(`${rel}:${line}`); continue; }
    // 비교 피연산자(`status === 'CANCELLED'`)는 발행 이름이 아니다 — 결과 갈래의 리터럴만
    const lits = [...expr.matchAll(/(?<![=!]==\s*)'([A-Za-z][A-Za-z0-9_.]+)'/g)].map((x) => x[1]);
    if (lits.length === 0) { dynamic.push(`${rel}:${line}`); continue; }
    for (const t of lits) sites.push({ type: t, where: `${rel}:${line}`, simulator });
  }
  // 시뮬레이터 헬퍼 emitEvent(entity, 'TYPE', …)
  for (const s of src.matchAll(/emitEvent\(\s*\w+\s*,\s*'([A-Z0-9_]+)'/g)) {
    sites.push({ type: s[1], where: `${rel}:${src.slice(0, s.index).split('\n').length}`, simulator: true });
  }
  return { sites, dynamic };
}

const all = walk(API_SRC).flatMap((f) => scanJourneyEmits(fs.readFileSync(f, 'utf8'), path.relative(API_SRC, f)).sites);
const vocab = new Set<string>(JOURNEY_EVENT_TYPES);

/** 사유 목록 동결 — 늘거나 줄면 이 목록을 사람이 같이 고친다 */
const NOT_EMITTED_FROZEN = [
  'ALERT', 'ATTENDING_CHANGE', 'FALL_RISK_ASSESSED', 'FOLLOWUP_SCHEDULED', 'HANDOFF',
  'INFECTION_DETECTED', 'MEAL_ORDER', 'NURSING_ASSESSMENT', 'ROUND', 'SAFETY_INCIDENT',
];

describe('여정 이벤트 어휘 ↔ 발행 지점', () => {
  it('⑤ 대조군 — 스캐너가 삼항·직접 create·동적 인자·시뮬레이터 헬퍼를 읽는다', () => {
    const fixture = [
      "this.journey.emit({ patientId, eventType: isMed ? 'PRESCRIPTION_ADDED' : 'ORDER_CREATED', title: 'x' });",
      "await this.prisma.patientJourneyEvent.create({ data: { patientId, eventType: 'BILLING_PAID', title: 'y' } });",
      'this.journey?.emit({ patientId, eventType: e.eventType, title: t });',
      "const eventType = s === 'ON_HOLD' ? 'DIAGNOSTIC_ON_HOLD' : null;\nif (eventType) { this.journey?.emit({ patientId, eventType, title: t }); }",
      "await this.emitEvent(e, 'ROUND', '회진', 'W');",
    ].join('\n');
    const r = scanJourneyEmits(fixture, 'modules/simulator/x.ts');
    expect(r.sites.map((s) => s.type).sort()).toEqual(['BILLING_PAID', 'DIAGNOSTIC_ON_HOLD', 'ORDER_CREATED', 'PRESCRIPTION_ADDED', 'ROUND']);
    expect(r.dynamic).toHaveLength(1);
    // 실트리 하한 — 0 이면 스캔이 죽은 것이다
    expect(all.length).toBeGreaterThan(50);
  });

  it('① 모든 리터럴 eventType 이 어휘 정본 안에 있다(시뮬레이터는 사유 목록 이름까지 허용)', () => {
    const outside = all
      .filter((s) => !vocab.has(s.type) && !(s.simulator && s.type in JOURNEY_EVENT_NOT_EMITTED))
      .map((s) => `${s.type} @ ${s.where}`);
    expect(outside, `shared JOURNEY_EVENT_TYPES 에 없는 이름으로 발행한다:\n${outside.join('\n')}`).toEqual([]);
  });

  it('② 어휘의 모든 유형이 도메인 발행 지점 ≥1 (시뮬레이터 제외)', () => {
    const emitted = new Set(all.filter((s) => !s.simulator).map((s) => s.type));
    const silent = JOURNEY_EVENT_TYPES.filter((t) => !emitted.has(t));
    expect(silent, `어휘에 있는데 발행 0 — 배선하거나 JOURNEY_EVENT_NOT_EMITTED 로 사유와 함께 옮긴다:\n${silent.join('\n')}`).toEqual([]);
  });

  it('③ 미발행 사유 목록 — 동결·사유 필수·어휘와 비겹침·도메인 발행 0', () => {
    expect(Object.keys(JOURNEY_EVENT_NOT_EMITTED).sort()).toEqual(NOT_EMITTED_FROZEN);
    for (const [k, why] of Object.entries(JOURNEY_EVENT_NOT_EMITTED)) {
      expect(why.trim().length, k).toBeGreaterThan(10);
      expect(vocab.has(k), `${k} 는 어휘와 사유 목록에 동시에 있다`).toBe(false);
    }
    const domainEmitted = all.filter((s) => !s.simulator && s.type in JOURNEY_EVENT_NOT_EMITTED).map((s) => `${s.type} @ ${s.where}`);
    expect(domainEmitted, '사유 목록의 이름을 도메인이 발행한다 — 어휘로 옮긴다').toEqual([]);
    for (const [from, to] of Object.entries(JOURNEY_EVENT_ALIASES)) {
      expect(from in JOURNEY_EVENT_NOT_EMITTED, from).toBe(true);
      expect(vocab.has(to), to).toBe(true);
    }
  });

  it('④ 위치 매핑 키·web 타임라인 아이콘 키가 어휘 안에 있다', () => {
    const svc = fs.readFileSync(path.join(API_SRC, 'modules/journey/journey.service.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    const mapBlock = /const map: Record<string, \{[^}]*\}> = \{([\s\S]*?)\n\s*\};/.exec(svc);
    expect(mapBlock, '위치 매핑 블록을 찾지 못했다').not.toBeNull();
    const mapKeys = [...mapBlock![1].matchAll(/'([A-Z_]+)':/g)].map((x) => x[1]);
    expect(mapKeys.length).toBeGreaterThan(10);
    expect(mapKeys.filter((k) => !vocab.has(k))).toEqual([]);

    // 🔴 (2026-10-01 여정 P3 UX) web 탭의 로컬 아이콘 표(26/63 유형)는 shared 표시 정본 `JOURNEY_EVENT_DISPLAY` 로 옮겼다 —
    //    정본은 `Record<JourneyEventType, …>` 라 어휘와 집합이 같아야 한다. 탭이 다시 자기 표를 두지 않는지도 본다.
    expect(Object.keys(JOURNEY_EVENT_DISPLAY).sort()).toEqual([...JOURNEY_EVENT_TYPES].sort());
    const tab = fs.readFileSync(WEB_JOURNEY_TAB, 'utf8').replace(/\/\/.*$/gm, '');
    expect(tab, '탭이 로컬 아이콘 표를 다시 두지 않는다(정본이 둘이 된다)').not.toMatch(/const TYPE_ICON/);
    // 탭은 웹 공용 도우미(`components/journey/journey-ui`)를 거쳐 정본을 쓴다 — 도우미가 정본을 부르는지까지 본다
    expect(tab).toMatch(/from '@\/components\/journey\/journey-ui'/);
    const ui = fs.readFileSync(path.resolve(__dirname, '../../../web/src/components/journey/journey-ui.ts'), 'utf8');
    expect(ui).toMatch(/journeyEventDisplay\(/);
    expect(ui, '도우미가 자기 아이콘 표를 두지 않는다').not.toMatch(/const TYPE_ICON/);
  });
});
