import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DrugInfoResolver, stripLeadingZeros } from '../../src/modules/portal/drug-info.resolver';
import {
  DrugExplainService,
  sanitizeExplainContent,
  filterForbiddenLines,
  drugNameForDur,
} from '../../src/modules/portal/drug-explain.service';

// F-7 처방·투약 AI 쉬운 설명 — 회귀 스펙
// ① resolver 선행 0 제거(운영 실측 §5.6-①②) ② 금칙어 후처리 ③ 캐시 히트 시 LLM 0회 ④ 잡 patientId 바인딩(PHI) ⑤ config 게이트

const flush = () => new Promise((r) => setImmediate(r));

function makePrisma() {
  return {
    medicationCode: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    dischargeSummary: { findMany: vi.fn().mockResolvedValue([]) },
    prescription: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    encounter: { findFirst: vi.fn().mockResolvedValue(null) },
    patient: { findUnique: vi.fn().mockResolvedValue(null) },
    drugExplainCache: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

const configOn = { get: vi.fn(async (k: string) => (k === 'portal.aiDrugExplain' ? true : null)) };
const configOff = { get: vi.fn(async () => false) };

describe('stripLeadingZeros (T-0 resolver 함정)', () => {
  it("선행 0을 제거한다 — '054801360' → '54801360'", () => {
    expect(stripLeadingZeros('054801360')).toBe('54801360');
    expect(stripLeadingZeros('0054801360')).toBe('54801360');
  });
  it('선행 0이 없으면 그대로, 전부 0이면 원본 유지', () => {
    expect(stripLeadingZeros('54801360')).toBe('54801360');
    expect(stripLeadingZeros('000')).toBe('000');
    expect(stripLeadingZeros(' 054801360 ')).toBe('54801360');
  });
});

describe('DrugInfoResolver — 2-hop 체인', () => {
  it('insuranceCode 선행 0 제거 후 drug-master를 호출한다', async () => {
    const prisma = makePrisma();
    prisma.medicationCode.findUnique.mockResolvedValue({ insuranceCode: '054801360', code: '054801360' });
    const medicalAi = {
      drugMaster: vi.fn().mockResolvedValue({ found: true, matches: [{ item_code: '201900221' }] }),
      eDrugInfo: vi.fn().mockResolvedValue({ found: true, efficacy: '혈전 생성을 억제', update_de: '2026-05-12', disclaimer: '정본' }),
    };
    const resolver = new DrugInfoResolver(prisma as never, medicalAi as never);
    const info = await resolver.resolve('med-1');
    expect(medicalAi.drugMaster).toHaveBeenCalledWith('54801360'); // ★ 선행 0 strip
    expect(medicalAi.eDrugInfo).toHaveBeenCalledWith('201900221');
    expect(info).toMatchObject({ itemCode: '201900221', updateDe: '2026-05-12', disclaimer: '정본' });
  });

  it('knownItemCode가 있으면 drug-master 생략(1-hop)', async () => {
    const prisma = makePrisma();
    const medicalAi = {
      drugMaster: vi.fn(),
      eDrugInfo: vi.fn().mockResolvedValue({ found: true, efficacy: 'x' }),
    };
    const resolver = new DrugInfoResolver(prisma as never, medicalAi as never);
    await resolver.resolve('med-1', '201900221');
    expect(medicalAi.drugMaster).not.toHaveBeenCalled();
    expect(medicalAi.eDrugInfo).toHaveBeenCalledWith('201900221');
  });

  it('해석 실패(found:false·매치 없음)는 null — 명칭 검색 자동 사용 금지(폴백)', async () => {
    const prisma = makePrisma();
    prisma.medicationCode.findUnique.mockResolvedValue({ insuranceCode: '99999999', code: '99999999' });
    const medicalAi = { drugMaster: vi.fn().mockResolvedValue({ found: false }), eDrugInfo: vi.fn() };
    const resolver = new DrugInfoResolver(prisma as never, medicalAi as never);
    expect(await resolver.resolve('med-1')).toBeNull();
    expect(medicalAi.eDrugInfo).not.toHaveBeenCalled();
  });
});

describe('금칙어 후처리', () => {
  it('금칙어 문장은 drop된다', () => {
    const r = sanitizeExplainContent({
      purpose: '이 약은 피를 묽게 해요. 증상이 좋아지면 복용을 중단하세요.',
      cautions: ['임신 중이면 의사에게 알리세요.', '아프면 용량을 늘리세요.'],
      sideEffects: ['속쓰림이 나타날 수 있어요.'],
      whenToCall: ['이 약 대신 드세요 다른 약을.'],
    });
    expect(r).not.toBeNull();
    expect(r!.purpose).toBe('이 약은 피를 묽게 해요.');
    expect(r!.cautions).toEqual(['임신 중이면 의사에게 알리세요.']);
    expect(r!.sideEffects).toEqual(['속쓰림이 나타날 수 있어요.']);
    expect(r!.whenToCall).toEqual([]);
  });

  it('전부 금칙어면 null(UNAVAILABLE 폴백)', () => {
    const r = sanitizeExplainContent({
      purpose: '이것은 감기 진단에 쓰입니다.',
      cautions: ['복용을 중단하세요.'],
      sideEffects: ['용량을 줄이세요.'],
      whenToCall: [],
    });
    expect(r).toBeNull();
  });

  it('배열 필터는 비문자열·빈 항목을 제거한다', () => {
    expect(filterForbiddenLines(['정상 문장', '', 42 as unknown as string, null as unknown as string])).toEqual(['정상 문장']);
    expect(filterForbiddenLines('not-array')).toEqual([]);
  });
});

describe('drugNameForDur — DUR은 명칭 배열 입력(§5.6-⑤)', () => {
  it('괄호 앞 제품명만 전달한다', () => {
    expect(drugNameForDur('케이아스피린장용정(아스피린)')).toBe('케이아스피린장용정');
    expect(drugNameForDur('타이레놀정 500mg')).toBe('타이레놀정 500mg');
  });
});

describe('DrugExplainService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let resolver: { resolve: ReturnType<typeof vi.fn> };
  let svc: DrugExplainService;

  beforeEach(() => {
    prisma = makePrisma();
    resolver = { resolve: vi.fn().mockResolvedValue(null) };
    svc = new DrugExplainService(prisma as never, configOn as never, resolver as never, undefined);
  });

  it('config OFF면 404(기능 부재와 동일 취급)', async () => {
    const off = new DrugExplainService(prisma as never, configOff as never, resolver as never, undefined);
    await expect(off.explainForPrescription('p1', 'rx1')).rejects.toThrow(NotFoundException);
    await expect(off.startEncounterExplain('p1', 'enc1')).rejects.toThrow(NotFoundException);
  });

  it('타 환자 처방은 404(본인 처방 검증)', async () => {
    prisma.prescription.findFirst.mockResolvedValue(null);
    await expect(svc.explainForPrescription('p1', 'rx-of-other')).rejects.toThrow(NotFoundException);
    expect(prisma.prescription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ encounter: { patientId: 'p1' } }) }),
    );
  });

  it('캐시 히트(30일 이내)면 LLM 0회·외부 해석 0회로 READY', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx1', dosage: '100mg', frequency: '1일 1회', duration: 30, route: 'PO',
      medicationCodeId: 'med-1', medicationCode: { nameKo: '케이아스피린장용정' },
    });
    prisma.drugExplainCache.findUnique.mockResolvedValue({
      medicationCodeId: 'med-1', itemCode: '201900221',
      content: { purpose: '피를 묽게 해요', cautions: [], sideEffects: [], whenToCall: [], generatedAt: '2026-07-01T00:00:00Z', disclaimer: '정본' },
      sourceVersion: '2026-05-12', createdAt: new Date(), approvedAt: new Date('2026-07-07'), approvedBy: 'ph-1',
    });
    const llmSpy = vi.spyOn(svc as never as { llmGenerate: () => Promise<string> }, 'llmGenerate');
    const res = await svc.explainForPrescription('p1', 'rx1');
    expect(res.status).toBe('READY');
    expect(llmSpy).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
    const explain = (res as { explain: Record<string, unknown> }).explain;
    expect(explain.purpose).toBe('피를 묽게 해요');
    expect(explain.disclaimer).toBe('정본'); // 서버 disclaimer 정본 유지(§6.5-④)
    expect((explain.source as Record<string, unknown>).updateDe).toBe('2026-05-12');
  });

  it('캐시 miss·해석 실패면 PENDING 잡 → DONE(UNAVAILABLE) — LLM 미호출(생성 금지)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx1', dosage: null, frequency: null, duration: null, route: null,
      medicationCodeId: 'med-1', medicationCode: { nameKo: '미해석약' },
    });
    const llmSpy = vi.spyOn(svc as never as { llmGenerate: () => Promise<string> }, 'llmGenerate');
    const res = await svc.explainForPrescription('p1', 'rx1');
    expect(res.status).toBe('PENDING');
    const jobId = (res as { jobId: string }).jobId;
    await flush();
    const job = svc.getJob('p1', jobId);
    expect(job.status).toBe('DONE');
    expect(job.result).toEqual({ status: 'UNAVAILABLE' });
    expect(llmSpy).not.toHaveBeenCalled();
  });

  it('잡은 patientId에 바인딩 — 타 환자 폴링은 404', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx1', dosage: null, frequency: null, duration: null, route: null,
      medicationCodeId: 'med-1', medicationCode: { nameKo: '약' },
    });
    const res = await svc.explainForPrescription('patient-A', 'rx1');
    const jobId = (res as { jobId: string }).jobId;
    await flush();
    expect(() => svc.getJob('patient-B', jobId)).toThrow(NotFoundException); // jobId 추측 차단
    expect(svc.getJob('patient-A', jobId).status).toBe('DONE');
    expect(() => svc.getJob('patient-A', 'no-such-job')).toThrow(NotFoundException);
  });

  it('개정 감지(30일 경과 + update_de 불일치)면 캐시 miss로 재생성 경로(PENDING)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx1', dosage: null, frequency: null, duration: null, route: null,
      medicationCodeId: 'med-1', medicationCode: { nameKo: '약' },
    });
    const stale = new Date(Date.now() - 31 * 86_400_000);
    prisma.drugExplainCache.findUnique.mockResolvedValue({
      medicationCodeId: 'med-1', itemCode: '201900221',
      content: { purpose: 'x', cautions: [], sideEffects: [], whenToCall: [] },
      sourceVersion: '2026-01-01', createdAt: stale,
    });
    resolver.resolve.mockResolvedValue({ itemCode: '201900221', updateDe: '2026-05-12', efficacy: 'y' });
    const res = await svc.explainForPrescription('p1', 'rx1');
    expect(res.status).toBe('PENDING');
    expect(resolver.resolve).toHaveBeenCalledWith('med-1', '201900221'); // 1-hop 재확인
  });

  it('30일 경과했지만 update_de 동일하면 hit 유지(확인 시각만 갱신)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx1', dosage: null, frequency: null, duration: null, route: null,
      medicationCodeId: 'med-1', medicationCode: { nameKo: '약' },
    });
    const stale = new Date(Date.now() - 31 * 86_400_000);
    prisma.drugExplainCache.findUnique.mockResolvedValue({
      medicationCodeId: 'med-1', itemCode: '201900221',
      content: { purpose: 'x', cautions: [], sideEffects: [], whenToCall: [] },
      sourceVersion: '2026-05-12', createdAt: stale, approvedAt: new Date('2026-07-07'), approvedBy: 'ph-1',
    });
    resolver.resolve.mockResolvedValue({ itemCode: '201900221', updateDe: '2026-05-12', efficacy: 'y' });
    const res = await svc.explainForPrescription('p1', 'rx1');
    expect(res.status).toBe('READY');
    expect(prisma.drugExplainCache.update).toHaveBeenCalled(); // checked_at 겸용 createdAt 리셋
  });

  describe('explainByName — 퇴원약 명칭 진입(자유 JSON·처방 ID 없음)', () => {
    const ownDs = [{ dischargeMedications: [{ drugName: '부루펜정 400mg', dosage: '1정' }] }];

    it('본인 퇴원요약에 없는 약명은 404(임의 약명 열람 차단)', async () => {
      prisma.dischargeSummary.findMany.mockResolvedValue(ownDs);
      await expect(svc.explainByName('p1', '타이레놀정')).rejects.toThrow('퇴원약을 찾을 수 없습니다');
    });

    it('마스터 정확일치가 0건/복수면 UNAVAILABLE(오매칭 방지)', async () => {
      prisma.dischargeSummary.findMany.mockResolvedValue(ownDs);
      prisma.medicationCode.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]); // 동명 복수
      await expect(svc.explainByName('p1', '부루펜정 400mg')).resolves.toEqual({ status: 'UNAVAILABLE' });
    });

    it('정확일치 1건 + 승인 캐시면 READY(용법은 퇴원 안내 폴백)', async () => {
      prisma.dischargeSummary.findMany.mockResolvedValue(ownDs);
      prisma.medicationCode.findMany.mockResolvedValue([{ id: 'med-1' }]);
      prisma.drugExplainCache.findUnique.mockResolvedValue({
        medicationCodeId: 'med-1', itemCode: '198300343',
        content: { purpose: 'p', cautions: [], sideEffects: [], whenToCall: [] },
        sourceVersion: '2025-03-24', createdAt: new Date(), approvedAt: new Date(), approvedBy: 'ph-1',
      });
      const res = await svc.explainByName('p1', '부루펜정 400mg');
      expect(res.status).toBe('READY');
      expect((res as { explain: { usage: { text: string } } }).explain.usage.text).toContain('퇴원 안내문');
    });
  });

  describe('extractJson — 복수 JSON/부가 텍스트 방어(2026-07-07 실측)', () => {
    it('첫 객체만 중괄호 짝으로 파싱한다("Extra data" 실패 방지)', () => {
      const out = (svc as never as { extractJson: (t: string) => unknown }).extractJson(
        '노이즈 {"purpose":"p","nested":{"x":"중괄호 } 문자열"}} {"second":true} 자체 면책문',
      );
      expect(out).toEqual({ purpose: 'p', nested: { x: '중괄호 } 문자열' } });
    });
  });

  describe('약사 승인제(2026-07-07 결정 — 미승인=환자 비노출)', () => {
    it('캐시가 있어도 미승인이면 UNAVAILABLE(PENDING_REVIEW)', async () => {
      prisma.prescription.findFirst.mockResolvedValue({
        id: 'rx1', dosage: null, frequency: null, duration: null, route: null,
        medicationCodeId: 'med-1', medicationCode: { nameKo: '약' },
      });
      prisma.drugExplainCache.findUnique.mockResolvedValue({
        medicationCodeId: 'med-1', itemCode: '201900221',
        content: { purpose: 'x', cautions: [], sideEffects: [], whenToCall: [] },
        sourceVersion: '2026-05-12', createdAt: new Date(), approvedAt: null, approvedBy: null,
      });
      const res = await svc.explainForPrescription('p1', 'rx1');
      expect(res).toEqual({ status: 'UNAVAILABLE', reason: 'PENDING_REVIEW' });
    });

    it('재생성(generateAndCache)은 승인을 리셋한다', async () => {
      prisma.drugExplainCache.findUnique.mockResolvedValue(null);
      resolver.resolve.mockResolvedValue({ itemCode: '201900221', updateDe: '2026-05-12', efficacy: '효능 원문' });
      vi.spyOn(svc as never as { llmGenerate: () => Promise<string> }, 'llmGenerate')
        .mockResolvedValue('{"purpose":"p","cautions":[],"sideEffects":[],"whenToCall":[]}');
      await (svc as never as { generateAndCache: (id: string, n: string) => Promise<unknown> }).generateAndCache('med-1', '약');
      const upsert = prisma.drugExplainCache.upsert.mock.calls[0][0];
      expect(upsert.update.approvedAt).toBeNull();
      expect(upsert.update.approvedBy).toBeNull();
    });

    it('adminApprove는 승인 시각·약사를 기록한다', async () => {
      prisma.drugExplainCache.update.mockResolvedValue({});
      await svc.adminApprove('med-1', 'pharmacist-1');
      expect(prisma.drugExplainCache.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ approvedBy: 'pharmacist-1' }) }),
      );
    });
  });
});
