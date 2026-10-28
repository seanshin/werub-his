/**
 * 청구 이의신청은 전송하지 않았다고 말한다(2026-10-13 결함 발굴 C1).
 *  · 🔴 종전: 상태만 SUBMITTED · 원 청구의 전송 기록(transmission)이 그대로 남아 화면이 그것을 읽었다(원 청구가 전송됐으면 이의신청도 "전송됨")
 *  · 이제: 이번 시도의 미전송 기록 · 제출 시각 비움 · 원 청구 기록은 previousTransmission · 화면 정본(claimTransmission)이 "미전송"
 */
import { describe, it, expect, vi } from 'vitest';
import { ClaimService } from '../../src/modules/claim/claim.service';
import { claimTransmission } from '../../../web/src/lib/claim-transmission';

const SENT = { channel: 'HIRA_EDI', outcome: 'SENT', receiptNo: 'R-1', transmittedAt: '2026-10-01T00:00:00Z' };
function mk() {
  const prisma: any = {
    claim: {
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', status: 'REJECTED', rejectReason: '코드 누락', claimData: { transmission: SENT } }),
      update: vi.fn(async ({ data }: any) => ({ id: 'c1', ...data })),
    },
  };
  return { svc: new (ClaimService as any)(prisma, { enqueue: vi.fn() }, { create: vi.fn() }) as ClaimService, prisma };
}

describe('🔴 이의신청 — 원 청구의 "전송됨"을 물려받지 않는다', () => {
  it('미전송 기록 · 제출 시각 null · 원 청구 기록 보존 · 화면 정본이 미전송', async () => {
    const { svc } = mk();
    const r: any = await svc.appeal('c1', { reason: '재심사 요청' });
    expect(r.submittedAt).toBeNull();
    expect(r.claimData.transmission).toMatchObject({ outcome: 'NOT_TRANSMITTED', kind: 'APPEAL', receiptNo: null });
    expect(r.claimData.previousTransmission).toEqual(SENT);
    expect(claimTransmission({ status: r.status, submittedAt: r.submittedAt, claimData: r.claimData })).toMatchObject({ transmitted: false, label: '미전송' });
  });
});
