import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// 계측 규칙 정본은 스캐너 하나 — 주석·문자열 토크나이저를 여기서 다시 만들지 않는다
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';
import { STORED_DEFAULT_BASELINE } from './stored-default-inventory.baseline';

/**
 * 🔴 **DB 에 저장되는 값에 기본값을 채우는 자리**(판정 규칙 §1 "화면이 값을 지어내지 않는다" 의 저장판).
 *
 * 표시 폴백은 새로고침하면 사라지지만, 저장된 기본값은 **사실로 남아** 다음 판단의 근거가 된다.
 * 2026-09-15 D3 전수(변이 핸들러 1,677 · 쓰기 인자 `data: { … }` 안의 `?? '리터럴'`/`|| '리터럴'` 221곳)에서
 * 확정 결함 10곳을 고쳤다:
 *  · 채팅 접수가 성별 미확인 환자를 **남성**으로 등록(`gender ?? 'MALE'`)하고, 작성자를 저장소 어디에도 없는
 *    고정 UUID 로 박았다(공개·무인증 세션도 이 경로) — 담당자 없는 등록은 창구로 넘긴다.
 *  · 응급 자동 종결이 처분 미기록 환자를 **귀가**로 적었다(`disposition ?? 'DISCHARGE'`) — 비워 둔다.
 *  · 수가 코드 생성이 **0원·본인부담 30%** 를 박았다(두 칸 모두 nullable) — null 로 남긴다.
 *  · 장비 사용 후 상태를 **정상**으로(`condition ?? 'NORMAL'`), 검진 진단 기록을 **'추적관찰/치료 필요'** 로,
 *    원격진료 주호소를 **'원격진료'** 로 적었다.
 *  · 사전승인 게이트 우회가 사유 없이 **'우회 발행'** 을 사유 칸에 적었다 → '(사유 미입력)'.
 *
 * 🔴 **파일별 정확 동결** — 총계로 동결하면 하나 고치고 하나 새로 만들어도 통과한다.
 *    늘면 실패한다: 저장 기본값을 새로 넣지 말고, 정당하면(정본에 기본값이 명시된 설정 등) 이유와 함께 기준선을 올린다.
 *    줄면 실패한다: 기준선을 낮춘다(여유 0).
 * 🔴 **상한이지 전수가 아니다** — 세는 것은 `data: { … }` 안의 **문자열·0 아닌 숫자** 리터럴 폴백뿐이다.
 *    불리언·빈값(`null`·`''`·`[]`·`{}`·`0`)과, 변수에 먼저 담아 넣는 모양은 세지 않는다.
 */
const MODULES = path.join(__dirname, '..', '..', 'src', 'modules');

/** `?? '리터럴'` / `|| '리터럴'` 중 **지어낸 값**만 — 빈값·0·불리언은 "없음"을 말하는 정직한 표현이라 제외 */
const FABRICATED_LITERAL = /(\w+)\s*:\s*[^,;\n{}]*?(?:\?\?|\|\|)\s*('(?!\s*')[^']*'|"(?!\s*")[^"]*"|[1-9]\d*(?:\.\d+)?)/g;

/** prisma 쓰기 인자 `data: { … }` 블록만 본다(조회 `where`·화면 응답은 이 가드의 범위가 아니다) */
export function storedDefaultHits(source: string): string[] {
  const s = stripComments(source) as string;
  const hits: string[] = [];
  const re = /\bdata:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = s.slice(m.index, j + 1);
    for (const hit of block.matchAll(FABRICATED_LITERAL)) hits.push(`${hit[1]}:${hit[2]}`);
  }
  return hits;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function inventory(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of tsFiles(MODULES)) {
    const n = storedDefaultHits(fs.readFileSync(f, 'utf8')).length;
    if (n > 0) out[path.relative(MODULES, f).split(path.sep).join('/')] = n;
  }
  return out;
}

describe('저장되는 기본값 인벤토리 — 파일별 정확 동결', () => {
  it('스캐너 대조군 — 지어낸 리터럴만 세고 빈값·불리언·주석은 세지 않는다', () => {
    expect(storedDefaultHits("await p.x.create({ data: { gender: dto.gender ?? 'MALE' } })")).toEqual(["gender:'MALE'"]);
    expect(storedDefaultHits("await p.x.create({ data: { n: dto.n ?? 21 } })")).toEqual(['n:21']);
    // 빈값·0·불리언은 "없음"을 말하는 정직한 표현이다
    expect(storedDefaultHits("await p.x.create({ data: { a: dto.a ?? null, b: dto.b ?? '', c: dto.c ?? 0, d: dto.d ?? false, e: dto.e ?? [] } })")).toEqual([]);
    // 조회 조건(where)·주석은 범위 밖
    expect(storedDefaultHits("await p.x.findMany({ where: { status: s ?? 'ACTIVE' } })")).toEqual([]);
    expect(storedDefaultHits("// data: { gender: dto.gender ?? 'MALE' }")).toEqual([]);
  });

  it('하한 — 스캔이 비어 조용히 통과하지 않는다', () => {
    expect(Object.keys(inventory()).length).toBeGreaterThan(50);
  });

  it('파일별 수가 기준선과 정확히 같다(늘면 새 날조 · 줄면 기준선을 낮춘다)', () => {
    const now = inventory();
    const files = [...new Set([...Object.keys(now), ...Object.keys(STORED_DEFAULT_BASELINE)])].sort();
    const drift = files
      .filter((f) => (now[f] ?? 0) !== (STORED_DEFAULT_BASELINE[f] ?? 0))
      .map((f) => `${f}: 기준선 ${STORED_DEFAULT_BASELINE[f] ?? 0} → 실측 ${now[f] ?? 0}`);
    expect(drift, '저장 기본값이 기준선과 다르다').toEqual([]);
  });

  it('🔴 D3 에서 고친 자리에는 되돌아오지 않는다 — 이 값들은 임상·청구 사실이다', () => {
    // 🔴 주석을 걸러 읽는다 — 이 스펙의 첫 판은 **자기 주석**("종전 `disposition ?? 'DISCHARGE'`")에 걸려 실패했다
    //    (판정 규칙 §3 "가드가 다른 이유로 통과·실패한다" · 주석이 문자열 검사에 걸린 v4.11.0 사례와 같은 모양).
    const read = (rel: string) => stripComments(fs.readFileSync(path.join(MODULES, rel), 'utf8')) as string;
    expect(storedDefaultHits(read('agent-session/agent-session.service.ts'))).not.toContain("gender:'MALE'");
    expect(read('agent-session/agent-session.service.ts')).not.toContain('00000000-0000-4000-a000-000000a00001');
    expect(read('emergency/emergency.service.ts')).not.toMatch(/disposition:\s*v\.disposition\s*\?\?\s*'DISCHARGE'/);
    expect(storedDefaultHits(read('code-master/code-master.service.ts'))).not.toContain('copayRate:0.3');
    expect(storedDefaultHits(read('equipment/equipment.service.ts'))).not.toContain("condition:'NORMAL'");
    expect(storedDefaultHits(read('telehealth/telehealth.service.ts'))).not.toContain("chiefComplaint:'원격진료'");
    expect(read('checkup/checkup.service.ts')).not.toContain('추적관찰/치료 필요');
    expect(read('pre-auth/pre-auth-gate.service.ts')).not.toMatch(/bypassReason:\s*\(ctx\.bypassReason \?\? '우회 발행'\)/);
  });
});
