import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **같은 사실을 반복해서 적으면 진짜 신호가 묻힌다** (2026-08-30 · 발굴 28회차 운영 실측).
 *
 * 하루치 운영 로그의 서비스별 줄 수를 세니 `IntegrationOutboxService` 가 **3,947줄**로
 * 전체의 대부분이었다. 내용은 "리허설 모드라 외부 발송 보류" — **동작은 정확한데**
 * 20초 주기 디스패처가 **같은 문장을 하루 4,300번** 남기고 있었다.
 * 그 아래 깔린 다른 서비스의 경고(하루 1~2줄)를 사람이 찾을 수 없다.
 *
 * → 보류는 정상 동작이므로 **상태가 바뀔 때만** 말한다(모드 또는 대기 건수 변화).
 *
 * 🔴 이 회차의 **원래 목표는 "54개 크론이 실제로 도는가"** 였고, 운영 빌드에서
 *    `SchedulerRegistry` 를 열어 **54/54 등록·다음 실행시각 확인** 으로 실결함 0건을 확인했다.
 *    가는 길에 `pm2 restarts=15,708` 을 보고 크래시 루프를 의심했으나,
 *    일자별 부팅 횟수가 **배포 횟수(10~15회/일)와 일치**해 누적치임을 확인하고 접었다.
 */
describe('🔴 주기 작업이 같은 사실을 반복해 적지 않는다', () => {
  const svc = readFileSync(
    join(process.cwd(), 'src/modules/integration/integration-outbox.service.ts'), 'utf8');

  it('보류 로그는 상태(모드·대기건수)가 바뀔 때만 남는다', () => {
    expect(svc, '직전 상태를 기억하지 않는다').toMatch(/private lastHoldStamp/);
    expect(svc).toMatch(/const stamp = `\$\{mode\}:\$\{held\}`/);
    expect(svc).toMatch(/if \(stamp !== this\.lastHoldStamp\)/);
  });

  it('🔴 보류 자체는 그대로 말한다 — 조용해지는 것과 숨기는 것은 다르다', () => {
    expect(svc, '보류 문구가 사라졌다').toContain('외부 발송을 하지 않는다');
    expect(svc, '무엇이 대기 중인지 밝히지 않는다').toContain('PENDING 유지');
    expect(svc, '반복하지 않는다는 사실을 사람에게 알려야 한다').toContain('변할 때만');
  });

  it('🔴 집계 실패를 0 으로 적지 않는다(대조군 — 종전 규약 유지)', () => {
    expect(svc).toContain("'집계 실패'");
  });

  it('🔴 행 상태는 건드리지 않는다(대조군 — 보류는 SENT 도 실패도 아니다)', () => {
    const i = svc.indexOf('allowsOutboundSend');
    const block = svc.slice(i, i + 1200);
    expect(block, '보류 경로에서 상태를 바꾼다').not.toMatch(/status:\s*'SENT'/);
    expect(block).not.toMatch(/this\.retry\(/);
  });
});
