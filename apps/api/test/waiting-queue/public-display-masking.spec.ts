import { describe, it, expect } from 'vitest';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';

/**
 * 2026-07 SSE/실시간 채널 인증 전수 회귀 — 공개 대기 디스플레이 PHI 마스킹.
 *
 * `/queue/public/stream` 은 무인증 공개 SSE(대기번호판)다. 여기에 환자 실명이 흐르면
 * 대기실 화면을 보는 누구나 PHI 를 본다. 이름은 반드시 `maskName`(홍○동)으로 가려야 한다.
 * 이 계약을 고정해, 공개 스트림 매핑이 실명을 노출하도록 바뀌면 실패하게 한다.
 */
describe('WaitingQueueService.maskName — 공개 디스플레이 PHI 마스킹', () => {
  const svc = new WaitingQueueService({} as any, {} as any, {} as any);

  it('3자 이상 이름은 가운데를 가린다(홍길동 → 홍○동)', () => {
    expect(svc.maskName('홍', '길동')).toBe('홍○동');
  });

  it('2자 이름은 뒤를 가린다(김철 → 김○)', () => {
    expect(svc.maskName('김', '철')).toBe('김○');
  });

  it('마스킹 결과에 원본 전체 이름이 남지 않는다', () => {
    const masked = svc.maskName('임', '영수');
    expect(masked).not.toBe('임영수');
    expect(masked).toContain('○');
  });

  it('긴 이름도 중간이 전부 가려진다(외국인 등)', () => {
    const masked = svc.maskName('왕', '웨이밍');
    expect(masked).toBe('왕○밍'); // 첫·끝만 노출, 중간 마스킹
    expect(masked).not.toContain('웨이');
  });
});
