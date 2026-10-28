/**
 * 🔴 가드 — 청구 '제출'이 나가지도 않은 채 제출 시각을 남기던 것(2026-08-20 전송 정직성 축).
 *
 * 원 결함: `ClaimService.submit()` / `InsuranceClaimService.submit()` 이 심평원으로 나가는
 * 전송 시도와 **무관하게** `status:'SUBMITTED'` · `submittedAt: new Date()` 를 적었다.
 * 심평원(요양기관업무포털) 전송 코드는 이 저장소에 존재한 적이 없고
 * (정본 `hira-edi/hira-transmission.ts` — 같은 결함을 EDI 명세서 층에서 이미 봉합했다),
 * `outbox.enqueue('claim.submitted')` 는 ERP 통보이지 보험자 제출이 아니다.
 * 그런데 화면 `/claims` 는 '제출' 배지와 제출 시각을 보여줬다.
 *
 * 이 스펙이 지키는 것:
 *  ① 전송에 성공하지 않았으면 `submittedAt` 을 남기지 않는다(모르는 시각을 원장에 박지 않는다)
 *  ② 미전송 사실이 근거로 남는다(`claimData.transmission` = NOT_TRANSMITTED + 수기 조치 안내)
 *  ③ 생성 시 기록한 claimData(reason·itemCount·createdFrom)를 제출이 지우지 않는다
 *  ④ 실제로 전송이 붙는 날(outcome==='SENT')에는 시각이 남는다 — 봉합이 기능을 죽이지 않았다
 *  ⑤ 두 쌍둥이 경로(claim / insurance-claim)가 같은 정본 함수를 쓴다
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ClaimService } from '../../src/modules/claim/claim.service';
import { InsuranceClaimService } from '../../src/modules/insurance-claim/insurance-claim.service';
import type { HiraTransmitResult } from '../../src/modules/hira-edi/hira-transmission';

/**
 * 전송 성공 분기는 채널이 붙는 날에만 실제로 발생한다(HIRA_CHANNEL.implemented=false).
 * 정본 함수만 갈아끼워 "붙었을 때"를 재현한다 — 나머지 경로는 전부 실제 정본 코드를 탄다.
 */
const stub = vi.hoisted(() => ({ impl: null as null | (() => Promise<HiraTransmitResult>) }));
vi.mock('../../src/modules/hira-edi/hira-transmission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/hira-edi/hira-transmission')>();
  return {
    ...actual,
    transmitToHira: (data: unknown) => (stub.impl ? stub.impl() : actual.transmitToHira(data)),
  };
});

const SRC = (p: string) =>
  readFileSync(join(__dirname, '../../src/modules', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '') // 원 결함을 기록한 주석은 판정에서 제외
    .replace(/\/\/.*$/gm, '');

describe('🔴 청구 제출 — 나가지 않았으면 제출 시각을 남기지 않는다 (ClaimService)', () => {
  let service: ClaimService;
  let prisma: any;
  let outbox: any;
  let last: any = {};

  beforeEach(() => {
    prisma = {
      claim: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'DRAFT',
          claimNumber: null,
          claimData: { reason: '외래 청구', itemCount: 3, createdFrom: 'billing' },
        }),
        // 상태 조건부 갱신(P2-3) — 쓴 data 를 이후 조회가 돌려준다
        updateMany: vi.fn().mockImplementation(({ data }: any) => { last = data; return Promise.resolve({ count: 1 }); }),
        findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve({ id: 'claim-1', claimedAmount: 100, ...last })),
      },
    };
    outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
    service = new ClaimService(prisma, outbox, { notify: vi.fn() } as never);
    stub.impl = null;
  });

  it('① 미전송이면 submittedAt 은 null 이다', async () => {
    await service.submit('claim-1');
    const data = prisma.claim.updateMany.mock.calls[0][0].data;
    expect(data.submittedAt).toBeNull();
  });

  it('② 미전송 근거가 claimData.transmission 에 남는다(수기 조치 안내 포함)', async () => {
    const r: any = await service.submit('claim-1');
    const data = prisma.claim.updateMany.mock.calls[0][0].data;
    expect(data.claimData.transmission.outcome).toBe('NOT_TRANSMITTED');
    expect(data.claimData.transmission.receiptNo).toBeNull();
    expect(data.claimData.transmission.note).toContain('[미전송]');
    expect(data.claimData.transmission.manualFallback).toContain('요양기관업무포털');
    expect(r.transmission.outcome).toBe('NOT_TRANSMITTED');
  });

  it('③ 생성 시 기록한 claimData 를 제출이 지우지 않는다', async () => {
    await service.submit('claim-1');
    const data = prisma.claim.updateMany.mock.calls[0][0].data;
    expect(data.claimData.reason).toBe('외래 청구');
    expect(data.claimData.itemCount).toBe(3);
  });

  it('③-b 이미 부여된 청구번호는 재제출이 덮어쓰지 않는다', async () => {
    prisma.claim.findUnique.mockResolvedValue({ status: 'SUBMITTED', claimNumber: 'CLM-EXISTING', claimData: {} });
    await service.submit('claim-1');
    expect(prisma.claim.updateMany.mock.calls[0][0].data.claimNumber).toBe('CLM-EXISTING');
  });

  it('④ 실제 전송에 성공하면(SENT) 기관이 접수한 시각을 남긴다', async () => {
    const at = new Date('2026-08-20T01:02:03.000Z');
    stub.impl = async () => ({ outcome: 'SENT', externalRef: 'HIRA-REAL-1', at });
    await service.submit('claim-1');
    const data = prisma.claim.updateMany.mock.calls[0][0].data;
    expect(data.submittedAt).toEqual(at);
    expect(data.claimData.transmission.outcome).toBe('SENT');
    expect(data.claimData.transmission.receiptNo).toBe('HIRA-REAL-1');
  });

  it('④-b 재제출이 outbox 에서 조용히 폐기되지 않는다(ref 가 제출 시도마다 다르다)', async () => {
    await service.submit('claim-1');
    const ref = outbox.enqueue.mock.calls[0][2];
    expect(ref).not.toMatch(/:$/); // 종전: submittedAt(null) 바인딩 → `claim:submit:<id>:` 로 고정
    expect(ref).toMatch(/^claim:submit:claim-1:\d+$/);
  });

  it('④-c ERP 페이로드가 전송 결과를 함께 알린다(수신측 오독 방지)', async () => {
    await service.submit('claim-1');
    const payload = outbox.enqueue.mock.calls[0][3];
    expect(payload.transmitted).toBe(false);
    expect(payload.transmissionOutcome).toBe('NOT_TRANSMITTED');
  });
});

describe('🔴 청구 제출 — 쌍둥이 경로 (InsuranceClaimService)', () => {
  let service: InsuranceClaimService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      claim: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'claim-1', status: 'DRAFT', claimNumber: null,
          claimData: { reason: '입원 청구', itemCount: 7, createdFrom: 'billing' },
          billing: { id: 'b-1' },
        }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'claim-1', ...data })),
      },
    };
    service = new InsuranceClaimService(prisma, undefined);
    stub.impl = null;
  });

  it('① 미전송이면 submittedAt 은 null 이다', async () => {
    await service.submit('claim-1', '<EDI/>', '메모');
    const data = prisma.claim.update.mock.calls[0][0].data;
    expect(data.submittedAt).toBeNull();
  });

  it('② 미전송 근거가 남고, ③ 기존 claimData 가 보존된다', async () => {
    await service.submit('claim-1', '<EDI/>');
    const data = prisma.claim.update.mock.calls[0][0].data;
    expect(data.claimData.transmission.outcome).toBe('NOT_TRANSMITTED');
    expect(data.claimData.transmission.note).toContain('[미전송]');
    expect(data.claimData.reason).toBe('입원 청구'); // 종전: 통째 덮어쓰기로 소실
    expect(data.claimData.itemCount).toBe(7);
    // 종전 `submitTime` 은 전송과 무관한 날조 시각이었다 — 다시 생기면 실패한다
    expect(data.claimData.submitTime).toBeUndefined();
  });

  it('④ SENT 면 시각을 남긴다', async () => {
    const at = new Date('2026-08-20T04:05:06.000Z');
    stub.impl = async () => ({ outcome: 'SENT', externalRef: 'HIRA-REAL-2', at });
    await service.submit('claim-1');
    expect(prisma.claim.update.mock.calls[0][0].data.submittedAt).toEqual(at);
  });
});

describe('🔴 구조 — 청구 층이 전송 정본을 우회하지 않는다', () => {
  it('⑤ 두 서비스 모두 정본 transmitToHira 를 부른다', () => {
    for (const f of ['claim/claim.service.ts', 'insurance-claim/insurance-claim.service.ts']) {
      expect(SRC(f)).toMatch(/transmitToHira\(/);
    }
  });

  it('⑤-b 무조건 제출 시각을 찍는 코드가 없다', () => {
    for (const f of ['claim/claim.service.ts', 'insurance-claim/insurance-claim.service.ts']) {
      expect(SRC(f)).not.toMatch(/submittedAt:\s*new Date\(\)/);
    }
  });
});
