import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 원시 분 표기 금지 가드 — 2026-08-12 (화면 점검 · 패턴 P5).
 *
 * 🔴 경과·대기 시간은 **위로 열려 있다.** `159분`·`352분`·`1815시간 1분`(=75일) 이 실제로 화면에
 *    떴다(접수 워크스테이션 최장 대기·관제 평균 대기·검사 보드 TAT). 사람은 60분을 넘는 분 수를
 *    머릿속에서 못 바꾼다. 정본은 `<Duration>` / `durationText` 하나다.
 *
 * **경계**: 상한이 있는 값(설문 예상 5분·진료 15분·임계값 30분)은 원시 분이 옳다 —
 * 이 가드는 *열린 값*(elapsed·wait·tat·op time)만 막는다.
 *
 * 기준선 동결: 아래 목록은 "확인했고 원시 분이 옳다"로 판정된 것. **새 위반이 생기면 실패한다.**
 */

const WEB_SRC = path.join(__dirname, '..', '..', 'src');

/** 열린 시간 값을 가리키는 이름 */
// 🔴 이름 규칙도 본다 — `cleaningMins`·`sinceReassessMins` 가 의미어에 안 걸려 살아남았고,
//    응급 베드 보드에 **`10287분 지연`**(=7일 3시간)이 떴다(2026-08-12 실측).
const OPEN_ENDED = /(wait|elapsed|tat|turnaround|opTime|stay|dwell|overdue|delay|\w+Mins?\b|\w+Minutes\b)/i;

/**
 * **상한이 정해진 값**은 원시 분이 옳다 — 목표치·경고 기준·예상 소요·예약 슬롯 길이.
 * 파일 단위로 예외를 주면 같은 파일의 진짜 위반까지 놓치므로 **이름으로** 가른다.
 */
const BOUNDED = /(target|warn|threshold|limit|goal|estimated|duration|interval|slot|budget)/i;

/** 확인 완료 — 상한이 있어 원시 분이 옳은 곳(파일:이유) */
const ALLOWED: Record<string, string> = {
  // 아래는 "확인했고 원시 분이 옳다" — 전부 **상한이 정해진 설정·예정값**이다(경과가 아니다).
  // 목표·기준·예상 소요는 위 BOUNDED 규칙이 걸러낸다 — 아래는 그 규칙으로 못 가르는 것만.
  'app/(main)/reception/components/AppointmentTab.tsx': '예약까지 남은/지난 시간 포맷터 — 방향성("후"/"지남")이 있어 durationText 로 대체 불가하고, 이미 시간·분을 나눠 표기한다',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('원시 분 표기 금지', () => {
  it('🔴 열린 시간 값(경과·대기·TAT)을 `{n}분` 으로 그리지 않는다', () => {
    const violations: string[] = [];

    for (const file of walk(WEB_SRC)) {
      const rel = path.relative(WEB_SRC, file).replace(/\\/g, '/');
      if (ALLOWED[rel]) continue;
      const src = fs.readFileSync(file, 'utf-8');

      src.split('\n').forEach((line, i) => {
        // `{...someWait...}분` / `{...elapsed...}<Unit>분</Unit>` / `` `${x}분` ``
        const jsx = /\{([^{}]*)\}\s*(?:<Unit>)?분/g;
        const tpl = /\$\{([^{}]*)\}분/g;
        for (const re of [jsx, tpl]) {
          let m: RegExpExecArray | null;
          while ((m = re.exec(line))) {
            const expr = m[1];
            if (!OPEN_ENDED.test(expr)) continue;
            if (BOUNDED.test(expr)) continue; // 목표·기준·예상 소요는 분이 읽기 쉽다
            if (/durationText|<Duration/.test(expr)) continue;
            violations.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
          }
        }
      });
    }

    expect(
      violations,
      `원시 분 표기 ${violations.length}건 — <Duration> 또는 durationText 를 쓰세요:\n` +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('예외를 두려면 사유를 적는다(빈 사유 금지)', () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${file}: 예외 사유가 비었다`).toBeGreaterThan(10);
    }
  });
});
