import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E4 가 고친 크론 실패 격리 — **소스 계약**으로 못박는다.
 *
 * 🔴 이 스펙은 동작 테스트(아래 `cron-failure-isolation-e4.behavior.spec.ts`)와 짝이다.
 *    소스 계약만 두면 모양만 맞추고 동작이 죽을 수 있고, 동작만 두면 다음 사람이 구조를 되돌린다.
 */
const SRC = join(__dirname, '../../src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** 주석을 지운 소스 — 🔴 주석에 적은 "종전엔 이랬다"가 검사에 걸리면 가드가 거짓말을 한다(이 라운드에서 한 번 겪었다) */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('🔴 자동 노쇼 — 쓰기와 발행을 나눈다', () => {
  const src = code('modules/schedule/schedule.service.ts');
  const body = src.slice(src.indexOf('autoNoShowSweep'), src.indexOf('async getStats'));

  it('상태 전환 실패는 로그로 남는다(빈 catch 가 아니다)', () => {
    expect(body).toMatch(/자동 노쇼 전환 실패/);
  });

  it('🔴 알림 발행 실패는 따로 잡아 error 로 남긴다 — 상태는 이미 바뀌어 다음 스윕이 잡지 않는다', () => {
    expect(body).toMatch(/자동 노쇼 알림 발행 실패/);
    expect(body).toMatch(/logger\.error/);
  });

  it('대조군 — 이 메서드에 빈 catch 가 없다', () => {
    expect(body).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });
});

describe('🔴 루프 크론 — 한 건이 나머지를 막지 않는다(poison message)', () => {
  it('검진권 만료: 건별 try/catch + 전건 실패 시 배치 종료(무한 루프 방지)', () => {
    const src = code('modules/voucher/voucher-cron.service.ts');
    const body = src.slice(src.indexOf('expireVouchers'), src.indexOf('suspendExpiredLicenses'));
    expect(body, '건별 보호가 없다').toMatch(/try\s*\{[\s\S]*?\$transaction/);
    expect(body).toMatch(/검진권 만료 실패/);
    expect(body, '전건 실패 시 배치를 끝내지 않으면 같은 조회가 영원히 반복된다').toMatch(/batchFailed === batch\.length/);
  });

  it('오더 서명 재봉인: 건별 try/catch — 맨 앞 행이 매번 막지 않는다', () => {
    const src = code('modules/order-sign-log/order-sign-log.service.ts');
    const body = src.slice(src.indexOf('retryFailedSeals'), src.indexOf('async byOrder'));
    expect(body).toMatch(/try\s*\{[\s\S]*?this\.seal\(/);
    expect(body).toMatch(/재봉인 실패/);
  });
});

describe('🔴 멱등 표시·재시도 표시 실패를 삼키지 않는다', () => {
  it('결재 리마인더: remindedAt 표시 실패를 남긴다(같은 알림 반복의 유일한 방지 근거다)', () => {
    const body = code('modules/ess/ess-approval-reminder.cron.ts');
    expect(body).toMatch(/결재 리마인더 발송 표시 실패/);
    expect(body, '표시 실패가 다시 조용해졌다').not.toMatch(/remindedAt: new Date\(\) \} \}\)\s*\.catch\(\(\) => undefined\)/);
  });

  it('outbox: 재시도/최종실패 표시가 실패하면 로그로 남긴다', () => {
    const body = code('modules/integration/integration-outbox.service.ts');
    expect(body).toMatch(/markRetry/);
    expect(body).toMatch(/표시 실패/);
    expect(body, '상태 갱신 실패가 다시 조용해졌다').not.toMatch(/status: 'FAILED'[^\n]*\}\s*\}\)\.catch\(\(\) => \{\}\)/);
  });

  it('위원회 재검토 알림 실패를 남긴다', () => {
    expect(code('modules/gld/governance.service.ts')).toMatch(/위원회 재검토 임박 알림 실패/);
  });
});
