import { describe, expect, it, vi } from 'vitest';
import { GldService, GOVERNANCE_STREAM, meetingRecordSha256 } from '../../src/modules/gld/gld.service';

/**
 * 의사록 sign 봉인 계약(P3·D5) — his-governance 스트림.
 * 원칙 고정: 완료 회의+의사록 존재만 봉인 가능·sign 비활성은 명시 거부(조용한 무봉인 방지)·
 * 봉인 후 의사록 불변·재봉인은 멱등.
 */

type AnyRecord = Record<string, unknown>;

function makeSvc(opts: { meeting?: AnyRecord | null; receipt?: AnyRecord; noSign?: boolean } = {}) {
  const meeting = opts.meeting === undefined ? {
    id: 'm1', title: '8월 정기회의', status: 'COMPLETED', minutes: '의결사항: DUR 병용금기 1쌍 추가',
    minutesSignedAt: null, minutesSignRef: null, scheduledAt: new Date('2026-08-04T09:00:00Z'),
    attendees: ['u1', 'u2', 'u3'], committee: { code: 'DTC', name: '약사위원회' },
  } : opts.meeting;
  const prisma = {
    committeeMeeting: {
      findUnique: vi.fn(async () => meeting),
      update: vi.fn(async (args: AnyRecord) => ({ ...(meeting as AnyRecord), ...(args.data as AnyRecord) })),
      // C5 — 봉인 쓰기는 아직 봉인되지 않은 행에만(조건부)
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const sign = opts.noSign ? undefined : {
    recordSignAuditEvent: vi.fn(async () => (opts.receipt ?? { ok: true, entryHash: 'hash-abc', anchorHead: 'anchor-1' })),
  };
  const svc = new GldService(prisma as never, sign as never);
  return { svc, prisma, sign };
}

describe('sealMeetingMinutes', () => {
  it('정상 봉인 — his-governance 스트림·anchor·sha256 만 전송(원문 미전송)·영수증 보관', async () => {
    const { svc, prisma, sign } = makeSvc();
    const r = await svc.sealMeetingMinutes('m1', 'admin-1', 'ADMIN') as AnyRecord;
    expect(r.sealed).toBe(true);
    const call = (sign!.recordSignAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AnyRecord;
    expect(call.stream).toBe(GOVERNANCE_STREAM);
    expect(call.anchor).toBe(true);
    expect((call.data as AnyRecord).minutesSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call.data)).not.toContain('의결사항'); // 원문은 체인에 싣지 않는다
    const upd = (prisma.committeeMeeting.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as AnyRecord;
    expect((upd.data as AnyRecord).minutesSignRef).toBe('hash-abc');
    expect(upd.where).toMatchObject({ id: 'm1', minutesSignedAt: null });
  });

  it('의사록 없음·미완료 회의는 거부', async () => {
    const { svc: noMinutes } = makeSvc({ meeting: { id: 'm1', status: 'COMPLETED', minutes: '  ', minutesSignedAt: null, scheduledAt: new Date(), committee: {} } });
    await expect(noMinutes.sealMeetingMinutes('m1', 'u')).rejects.toThrowError(/비어/);
    const { svc: notDone } = makeSvc({ meeting: { id: 'm1', status: 'SCHEDULED', minutes: '내용', minutesSignedAt: null, scheduledAt: new Date(), committee: {} } });
    await expect(notDone.sealMeetingMinutes('m1', 'u')).rejects.toThrowError(/완료/);
  });

  it('sign 비활성(skipped)·미주입은 명시 거부 — 조용한 무봉인 방지', async () => {
    const { svc: skipped } = makeSvc({ receipt: { ok: false, skipped: true, reason: 'sign 미설정' } });
    await expect(skipped.sealMeetingMinutes('m1', 'u')).rejects.toThrowError(/비활성/);
    const { svc: noSign } = makeSvc({ noSign: true });
    await expect(noSign.sealMeetingMinutes('m1', 'u')).rejects.toThrowError(/미주입/);
  });

  it('이미 봉인이면 멱등 반환(체인 append 없음)', async () => {
    const { svc, sign } = makeSvc({ meeting: { id: 'm1', status: 'COMPLETED', minutes: '내용', minutesSignedAt: new Date(), minutesSignRef: 'hash-old', scheduledAt: new Date(), committee: {} } });
    const r = await svc.sealMeetingMinutes('m1', 'u') as AnyRecord;
    expect(r.alreadySealed).toBe(true);
    expect(sign!.recordSignAuditEvent).not.toHaveBeenCalled();
  });

  it('봉인 후 의사록 수정 거부(불변) — 다른 필드는 수정 가능', async () => {
    const sealedMeeting = { id: 'm1', minutesSignedAt: new Date() };
    const prisma = {
      committeeMeeting: {
        findUnique: vi.fn(async () => sealedMeeting),
        update: vi.fn(async () => ({})),
      },
    };
    const svc = new GldService(prisma as never, undefined as never);
    await expect(svc.updateMeeting('m1', { minutes: '수정 시도' })).rejects.toThrowError(/봉인된 회의 기록/);
    // 🔴 (C5) 의결·참석자·제목·일시도 봉인 범위 — 종전엔 의사록만 막았다
    for (const d of [{ decisions: [{ x: 1 }] }, { attendees: ['u9'] }, { title: '바꾼 제목' }, { scheduledAt: '2026-08-05T00:00:00Z' }]) {
      await expect(svc.updateMeeting('m1', d as never), JSON.stringify(d)).rejects.toThrowError(/봉인된 회의 기록/);
    }
    await expect(svc.updateMeeting('m1', { location: '대회의실' })).resolves.toBeDefined();
  });

  it('🔴 (C5) 봉인 해시는 의결·참석자까지 덮는다 · 참석자 순서는 기록이 아니다 · 봉인 사이에 바뀌면 봉인하지 않는다', async () => {
    const base = { title: 't', scheduledAt: new Date('2026-08-04T09:00:00Z'), minutes: 'm', decisions: [{ a: 1 }], attendees: ['u1', 'u2'] };
    expect(meetingRecordSha256(base)).not.toBe(meetingRecordSha256({ ...base, decisions: [{ a: 2 }] }));
    expect(meetingRecordSha256(base)).not.toBe(meetingRecordSha256({ ...base, attendees: ['u1'] }));
    expect(meetingRecordSha256(base)).toBe(meetingRecordSha256({ ...base, attendees: ['u2', 'u1'] }));
    const { svc, prisma, sign } = makeSvc();
    const first = await prisma.committeeMeeting.findUnique();
    (prisma.committeeMeeting.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...(first as AnyRecord), attendees: ['u1'] });
    await expect(svc.sealMeetingMinutes('m1', 'u')).rejects.toThrowError(/바뀌어/);
    expect(prisma.committeeMeeting.updateMany).not.toHaveBeenCalled();
    expect(((sign!.recordSignAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AnyRecord).data).toHaveProperty('recordSha256');
  });
});
