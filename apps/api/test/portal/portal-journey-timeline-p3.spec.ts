/**
 * 포털 여정 타임라인 P3(2026-10-01) — 모바일 타임라인 검토 결함 봉합.
 * 지키는 것:
 *  ① 설명이 null 인 비안전 유형(입원)도 서버가 유형별 고정 라벨·트랙을 싣는다(모바일 빈 줄 봉합) · 자유 title 은 싣지 않는다
 *  ② 상한보다 행이 많으면 take=N+1 로 보고 meta.truncated=true · 대조군 — 딱 N 이면 false
 *  ③ date-only `to` 는 그 KST 하루 끝까지(lt 다음 날 KST 자정) · ISO 는 그 순간 그대로 · 못 읽으면 400
 *  ④ ER_CHECKOUT 의 `처분: <코드>` 는 환자 말로 · DEATH·어휘 밖·형식 밖은 설명 없음(코드를 보이지 않는다)
 *  ⑤ 발생/기록 시각 필드를 select 한다
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';

function row(over: Record<string, unknown>) {
  return {
    id: 'e1', eventType: 'ADMISSION', eventAt: new Date('2026-09-30T01:00:00Z'), description: null,
    severity: 'INFO', refType: 'Admission', occurredAt: null, occurredAtSource: 'UNKNOWN', occurredAtPrecision: null,
    createdAt: new Date('2026-09-30T01:00:00Z'), ...over,
  };
}

function makeSvc(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const svc = Object.create(PortalService.prototype) as PortalService;
  (svc as any).prisma = { patientJourneyEvent: { findMany } };
  return { svc, findMany };
}

describe('포털 여정 타임라인 P3', () => {
  it('① 비안전 유형(설명 null)에도 라벨·트랙이 실린다 · title 은 싣지 않는다', async () => {
    const { svc, findMany } = makeSvc([row({ eventType: 'ADMISSION', description: '직원 메모: 격리 필요' })]);
    const out = await svc.getJourneyTimeline('p1');
    expect(out[0].description).toBeNull();
    expect(out[0].label).toBe('입원');
    expect(out[0].track).toBe('IPD');
    expect(findMany.mock.calls[0][0].select.title).toBeUndefined();
    expect(out[0]).not.toHaveProperty('title');
  });

  it('① 대조군 — 어휘 밖 유형은 라벨 null(코드를 라벨로 지어내지 않는다)', async () => {
    const { svc } = makeSvc([row({ eventType: 'SOMETHING_NEW' })]);
    const out = await svc.getJourneyTimeline('p1');
    expect(out[0].label).toBeNull();
    expect(out[0].track).toBeNull();
  });

  it('② 상한보다 많으면 truncated=true 이고 상한만큼만 돌려준다(take=N+1)', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => row({ id: `e${i}` }));
    const { svc, findMany } = makeSvc(rows);
    const res = await svc.getJourneyTimeline('p1', undefined, undefined, 3, { withMeta: true });
    expect(findMany.mock.calls[0][0].take).toBe(4);
    expect(res.truncated).toBe(true);
    expect(res.items).toHaveLength(3);
  });

  it('② 대조군 — 딱 상한이면 truncated=false', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => row({ id: `e${i}` }));
    const { svc } = makeSvc(rows);
    const res = await svc.getJourneyTimeline('p1', undefined, undefined, 3, { withMeta: true });
    expect(res.truncated).toBe(false);
    expect(res.items).toHaveLength(3);
  });

  it('② 상한은 100 으로 묶인다(take 101)', async () => {
    const { svc, findMany } = makeSvc([]);
    await svc.getJourneyTimeline('p1', undefined, undefined, 500, { withMeta: true });
    expect(findMany.mock.calls[0][0].take).toBe(101);
  });

  it('③ date-only to 는 그 KST 하루 끝까지 포함한다', async () => {
    const { svc, findMany } = makeSvc([]);
    await svc.getJourneyTimeline('p1', '2026-09-30', '2026-09-30');
    const eventAt = findMany.mock.calls[0][0].where.eventAt;
    expect(eventAt.gte).toEqual(new Date(2026, 8, 30, 0, 0, 0, 0));
    expect(eventAt.lt).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(eventAt.lte).toBeUndefined();
    // KST 23:30 사건은 구간 안
    const late = new Date('2026-09-30T14:30:00Z');
    if (process.env.TZ === 'Asia/Seoul' || new Date(2026, 8, 30).getTimezoneOffset() === -540) {
      expect(late >= eventAt.gte && late < eventAt.lt).toBe(true);
    }
  });

  it('③ 시각 포함 ISO(모바일 현행)는 그 순간 그대로', async () => {
    const { svc, findMany } = makeSvc([]);
    const iso = '2026-09-23T03:04:05.000Z';
    await svc.getJourneyTimeline('p1', iso);
    expect(findMany.mock.calls[0][0].where.eventAt).toEqual({ gte: new Date(iso) });
  });

  it('③ 못 읽는 날짜는 400(500 아님)', async () => {
    const { svc } = makeSvc([]);
    await expect(svc.getJourneyTimeline('p1', 'not-a-date')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['처분: DISCHARGE', '퇴실 후 귀가'],
    ['처분: ADMISSION', '퇴실 후 입원'],
    ['처분: TRANSFER', '퇴실 후 다른 병원으로 전원'],
    ['처분: OBSERVATION', '퇴실 후 관찰'],
  ])('④ ER_CHECKOUT %s → %s', async (raw, text) => {
    const { svc } = makeSvc([row({ eventType: 'ER_CHECKOUT', description: raw })]);
    const out = await svc.getJourneyTimeline('p1');
    expect(out[0].description).toBe(text);
    expect(out[0].label).toBe('응급실 퇴실');
  });

  it.each(['처분: DEATH', '처분: ADMIT', '처분: WHATEVER', '임의 문장 ADMISSION'])('④ ER_CHECKOUT %s → 설명 없음(코드 비노출)', async (raw) => {
    const { svc } = makeSvc([row({ eventType: 'ER_CHECKOUT', description: raw })]);
    const out = await svc.getJourneyTimeline('p1');
    expect(out[0].description).toBeNull();
  });

  it('④ 대조군 — 다른 안전 유형 설명은 그대로', async () => {
    const { svc } = makeSvc([row({ eventType: 'LAB_RESULT', description: '5개 항목 · 정상' })]);
    const out = await svc.getJourneyTimeline('p1');
    expect(out[0].description).toBe('5개 항목 · 정상');
  });

  it('⑤ 발생·기록 시각 필드를 select 하고 그대로 싣는다', async () => {
    const occurredAt = new Date('2026-09-30T00:10:00Z');
    const { svc, findMany } = makeSvc([row({ occurredAt, occurredAtSource: 'DOMAIN_FIELD', occurredAtPrecision: 'MINUTE' })]);
    const out = await svc.getJourneyTimeline('p1');
    const sel = findMany.mock.calls[0][0].select;
    for (const k of ['occurredAt', 'occurredAtSource', 'occurredAtPrecision', 'createdAt']) expect(sel[k], k).toBe(true);
    expect(out[0].occurredAt).toEqual(occurredAt);
    expect(out[0].occurredAtSource).toBe('DOMAIN_FIELD');
  });
});
