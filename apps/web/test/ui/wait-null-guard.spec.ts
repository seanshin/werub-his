/**
 * 대기시간 null(산출 불가) 소비 가드 (W8 · R8 추가분)
 *
 * 🔴 서버가 오늘 바뀌었다 — 표본이 없으면 평균/예상 대기가 **0 이 아니라 `null`** 이다.
 *    `0분` 은 "기다림이 없다"는 관측된 사실로 읽혀서, 대기 인원이 수백 명이어도 화면이 안심시켰다.
 *    실측(2026-08-14): 외래 waiting_queue 오늘분 198건 전부 `startedAt` 미기록 = 표본 0.
 *
 *  · queue-display.service.ts  avgWaitMinutes / maxWaitMinutes / estimatedWaitMinutes → null + waitSampleN
 *  · waiting-queue.service.ts  waitSampleN / waitUnmeasuredN / waitBasis
 *  · journey.service.ts        avgOutpatientWaitMinutes + outpatientWaitSampleN
 *
 * FE 가 `|| 0` / `?? 0` 로 접으면 서버의 정직함이 화면에서 그대로 되돌아간다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const SRC_DIR = resolve(__dirname, '../../src');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(e.name) && !/\.spec\./.test(e.name)) out.push(p);
  }
  return out;
}

describe('대기시간 null 을 0 으로 접지 않는다 (P1)', () => {
  it('🔴 어느 화면도 avgWaitMinutes/maxWaitMinutes/estimatedWaitMinutes 를 `|| 0` · `?? 0` 로 접지 않는다', () => {
    const offenders: string[] = [];
    for (const f of tsFiles(SRC_DIR)) {
      const src = stripComments(readFileSync(f, 'utf8'));
      // 🔴 표시(display) 폴드만 잡는다. `(x ?? 0) > 30` 처럼 **임계 비교**에 쓰는 것은
      //    미상을 '경고 아님'으로 처리하는 것이라 안전한 쪽이다(admin/qi 가 그렇게 쓴다).
      const re = /(avgWaitMinutes|maxWaitMinutes|estimatedWaitMinutes|avgOutpatientWaitMinutes)\s*(\|\||\?\?)\s*0(.{0,4})/g;
      for (const m of src.matchAll(re)) {
        if (/^\s*\)?\s*[<>]/.test(m[3] ?? '')) continue; // 임계 비교
        offenders.push(`${f.replace(SRC_DIR, 'src')} → ${m[1]} ${m[2]} 0`);
      }
    }
    expect(offenders, '표본 부재는 0분이 아니다 — null 로 두고 근거(waitSampleN·waitBasis)를 말하라').toEqual([]);
  });
});

describe('공개 전광판 — 표본 없는 과를 평균에 섞지 않는다', () => {
  const BOARD = stripComments(
    readFileSync(resolve(SRC_DIR, 'app/display/_boards/ClinicQueueBoard.tsx'), 'utf8'),
  );

  it('🔴 avgWaitMinutes 타입이 nullable 이다 (서버가 null 을 보낸다)', () => {
    expect(BOARD).toMatch(/avgWaitMinutes:\s*number\s*\|\s*null/);
  });

  it('🔴 전원 평균은 표본이 있는 과만으로 낸다 — null 을 0 으로 섞으면 평균이 희석된다', () => {
    expect(BOARD).toMatch(/filter\(\(d\)\s*=>\s*d\.avgWaitMinutes\s*!=\s*null\)/);
  });

  it('🔴 과별 표기도 null 검사를 먼저 한다', () => {
    expect(BOARD).toMatch(/d\.avgWaitMinutes\s*!=\s*null\s*&&/);
  });
});

describe('접수 대기 현황 — 산출 불가를 침묵하지 않는다', () => {
  const TAB = stripComments(
    readFileSync(resolve(SRC_DIR, 'app/(main)/reception/components/QueueTab.tsx'), 'utf8'),
  );

  it('🔴 서버가 낸 근거(waitBasis)를 화면이 말한다', () => {
    expect(TAB).toMatch(/waitBasis/);
  });

  it('🔴 표본이 없어 과별 평균이 하나도 없을 때 카드가 통째로 사라지지 않는다', () => {
    expect(TAB).toContain('평균 대기시간 산출 불가');
  });
});
