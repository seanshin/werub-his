import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';
import { OPENING_REGISTRY } from '../../src/modules/opening/opening.registry';

/**
 * 🔴 Go-Live 항목 수의 정본은 하나다 — 외부 실측 §5(2026-09-14) · main 회수 2026-09-23.
 *
 * 개원 레지스트리 `open.system.goLive` 의 비고가 **"상세 58항목"** 이라고 적고 있었다.
 * 그 비고는 바로 다음 문장에서 "여기서 세지 않는다"고 말하면서 **수를 세고 있었고**,
 * 정본(`GO_LIVE_REGISTRY`)이 60 으로 늘어난 뒤에도 58 로 남아 있었다(같은 파일 O6 주석도 58).
 * 수를 두 곳에 적으면 갈라진다 — 갈라졌다.
 *
 * 이 가드는 "지금 몇 개인가"를 못박지 않는다(그러면 세 번째 정본이 된다).
 * **개원 레지스트리(비고·O6 주석)가 Go-Live 항목 수를 적지 않는다**만 본다.
 *
 * 재주입: 비고에 `58항목` 을 되돌리면 ②가, O6 주석에 `58항목` 을 되돌리면 ③이 실패한다.
 */
const OPENING_SRC = resolve(__dirname, '../../src/modules/opening/opening.registry.ts');
const COUNT_WORD = /\d+\s*(항목|개)/;

describe('Go-Live 항목 수는 한 곳에서만 센다(§5)', () => {
  it('대조군 — 정본 레지스트리가 비어 있지 않다(0 이면 이 가드는 무의미하다)', () => {
    expect(GO_LIVE_REGISTRY.length).toBeGreaterThan(30);
  });

  it('🔴 ② 개원 레지스트리의 Go-Live 항목 비고가 항목 수를 적지 않는다', () => {
    const item = OPENING_REGISTRY.find((d) => d.key === 'open.system.goLive');
    expect(item, 'open.system.goLive 항목이 있어야 한다').toBeTruthy();
    const note = item!.note ?? '';
    // `<숫자>항목` / `<숫자>개` 처럼 개수를 세는 표기가 없어야 한다
    expect(COUNT_WORD.test(note), `비고가 개수를 적고 있다: ${note}`).toBe(false);
    // 대신 정본이 어디인지는 말해야 한다(수를 지우고 아무 말도 안 하면 길을 잃는다)
    expect(note).toContain('/admin/go-live');
  });

  it('🔴 ③ 같은 파일의 O6 구역 주석도 항목 수를 적지 않는다(비고만 고치면 주석이 다음 사람을 속인다)', () => {
    const src = readFileSync(OPENING_SRC, 'utf8');
    const start = src.indexOf('O6 정보시스템 개시');
    const end = src.indexOf('O7 시험운영');
    expect(start, 'O6 구역 머리 주석을 찾지 못했다').toBeGreaterThan(-1);
    expect(end, 'O7 구역 머리 주석을 찾지 못했다').toBeGreaterThan(start);
    const section = src.slice(start, end);
    // 🔴 대조군 — 구역을 실제로 잘라 왔는지(비어 있으면 아래 검사는 빈 검사)
    expect(section).toContain('open.system.goLive');
    const hits = [...section.matchAll(/\d+\s*(항목|개)/g)].map((m) => m[0]);
    expect(hits, `O6 구역이 개수를 적고 있다`).toEqual([]);
  });
});
