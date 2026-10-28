import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FormularyService } from '../../src/modules/formulary/formulary.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// 원내 처방집 핵심 로직 회귀 스펙 — 등재 멱등·토글 순환·심의 규칙·정책 게이트·상태 batch
function makePrisma() {
  return {
    formularyItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    formularyRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    formularyList: { create: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
    medicationCode: { findMany: vi.fn().mockResolvedValue([]) },
    procedureCode: { findMany: vi.fn().mockResolvedValue([]) },
    nursingCode: { findMany: vi.fn().mockResolvedValue([]) },
    prescription: { findMany: vi.fn().mockResolvedValue([]) },
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe('FormularyService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: FormularyService;
  const U = 'user-1';

  beforeEach(() => {
    prisma = makePrisma();
    svc = new FormularyService(prisma as never);
  });

  describe('영역 검증', () => {
    it('잘못된 영역은 거부한다', async () => {
      await expect(svc.list('WRONG')).rejects.toThrow(BadRequestException);
      expect(() => svc.startAiDraft({ domain: 'NOPE', topic: 'x' })).toThrow(BadRequestException);
    });
  });

  describe('등재(add)', () => {
    it('신규 코드는 ACTIVE로 생성한다', async () => {
      const r = await svc.add(U, { domain: 'MEDICATION', items: [{ codeId: 'c1' }] });
      expect(r).toEqual({ created: 1, reactivated: 0 });
      expect(prisma.formularyItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ domain: 'MEDICATION', codeType: 'MEDICATION_CODE', codeId: 'c1' }) }),
      );
    });

    it('기존 ACTIVE 항목은 중복 생성하지 않는다(멱등)', async () => {
      prisma.formularyItem.findFirst.mockResolvedValueOnce({ id: 'f1', status: 'ACTIVE' }); // add()는 null 필드 compound findUnique 함정 회피로 findFirst 사용
      const r = await svc.add(U, { domain: 'MEDICATION', items: [{ codeId: 'c1' }] });
      expect(r).toEqual({ created: 0, reactivated: 0 });
      expect(prisma.formularyItem.create).not.toHaveBeenCalled();
    });

    it('SUSPENDED/REMOVED 항목은 재활성화한다', async () => {
      prisma.formularyItem.findFirst.mockResolvedValueOnce({ id: 'f1', status: 'SUSPENDED', committee: null, note: null });
      const r = await svc.add(U, { domain: 'LAB', items: [{ codeId: 'c1' }] });
      expect(r).toEqual({ created: 0, reactivated: 1 });
      expect(prisma.formularyItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
      );
    });

    it('빈 items는 거부한다', async () => {
      await expect(svc.add(U, { domain: 'LAB', items: [] })).rejects.toThrow(BadRequestException);
    });

    it('치료/활동은 PRESET 코드타입으로 등재한다', async () => {
      await svc.add(U, { domain: 'THERAPY', items: [{ presetKey: 'PT_EXERCISE' }] });
      expect(prisma.formularyItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ codeType: 'PRESET', presetKey: 'PT_EXERCISE' }) }),
      );
    });
  });

  describe('토글(코드마스터 원클릭)', () => {
    it('미등재 → 등재(ACTIVE)', async () => {
      const r = await svc.toggle(U, { domain: 'MEDICATION', codeId: 'c1' });
      expect(r.status).toBe('ACTIVE');
      expect(prisma.formularyItem.create).toHaveBeenCalled();
    });

    it('ACTIVE → SUSPENDED → ACTIVE 순환', async () => {
      prisma.formularyItem.findFirst.mockResolvedValueOnce({ id: 'f1', status: 'ACTIVE' });
      expect((await svc.toggle(U, { domain: 'MEDICATION', codeId: 'c1' })).status).toBe('SUSPENDED');
      prisma.formularyItem.findFirst.mockResolvedValueOnce({ id: 'f1', status: 'SUSPENDED' });
      expect((await svc.toggle(U, { domain: 'MEDICATION', codeId: 'c1' })).status).toBe('ACTIVE');
    });
  });

  describe('등재 요청·심의', () => {
    it('사유 없는 요청은 거부한다', async () => {
      await expect(svc.createRequest(U, undefined, { domain: 'MEDICATION', codeId: 'c1', reason: ' ' })).rejects.toThrow(BadRequestException);
    });

    it('코드도 신규명도 없으면 거부한다', async () => {
      await expect(svc.createRequest(U, undefined, { domain: 'MEDICATION', reason: '필요' })).rejects.toThrow(BadRequestException);
    });

    it('반려는 사유가 필수다', async () => {
      prisma.formularyRequest.findUnique.mockResolvedValue({ id: 'r1', status: 'PENDING', codeId: 'c1', domain: 'MEDICATION', reason: 'x' });
      await expect(svc.decide(U, 'r1', { approve: false })).rejects.toThrow(BadRequestException);
    });

    it('승인 시 요청 코드가 처방집에 자동 등재된다', async () => {
      prisma.formularyRequest.findUnique.mockResolvedValue({ id: 'r1', status: 'PENDING', codeId: 'c1', domain: 'MEDICATION', reason: '임상 필요' });
      prisma.formularyRequest.update.mockResolvedValue({ id: 'r1', status: 'APPROVED' });
      await svc.decide(U, 'r1', { approve: true });
      expect(prisma.formularyItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ codeId: 'c1' }) }),
      );
    });

    it('이미 처리된 요청은 재심의할 수 없다', async () => {
      prisma.formularyRequest.findUnique.mockResolvedValue({ id: 'r1', status: 'APPROVED' });
      await expect(svc.decide(U, 'r1', { approve: true })).rejects.toThrow(BadRequestException);
    });

    it('존재하지 않는 요청은 404', async () => {
      await expect(svc.decide(U, 'nope', { approve: true })).rejects.toThrow(NotFoundException);
    });

    it('동시 심의 race는 409로 차단한다(PENDING 조건부 갱신 count=0)', async () => {
      prisma.formularyRequest.findUnique.mockResolvedValue({ id: 'r1', status: 'PENDING', codeId: 'c1', domain: 'MEDICATION', reason: 'x' });
      prisma.formularyRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.decide(U, 'r1', { approve: true })).rejects.toThrow(ConflictException);
      expect(prisma.formularyItem.create).not.toHaveBeenCalled();
    });

    it('동일 (domain, codeId) PENDING 요청이 있으면 기존 요청을 반환한다(중복 누적 방지)', async () => {
      const dup = { id: 'r-dup', status: 'PENDING', domain: 'MEDICATION', codeId: 'c1' };
      prisma.formularyRequest.findFirst.mockResolvedValue(dup);
      const r = await svc.createRequest(U, undefined, { domain: 'MEDICATION', codeId: 'c1', reason: '필요' });
      expect(r).toBe(dup);
      expect(prisma.formularyRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('정책 게이트(OFF/WARN/BLOCK)', () => {
    it('미설정이면 전 영역 OFF', async () => {
      const p = await svc.getPolicy();
      expect(p.MEDICATION).toBe('OFF');
      expect(Object.keys(p)).toHaveLength(7);
    });

    // 🔴 W8-R2 F2(2026-08-14) — 종전 이 스펙은 `LAB:'HACK'` → 'OFF' 를 정답으로 굳혀뒀다(fail-open).
    //   저장소 정본 common/gate-mode.ts 의 gateMode() 는 **미지값=BLOCK**(fail-closed)이다.
    //   안전 게이트의 미상값을 '무통제'로 읽는 것은 오타 한 글자로 통제를 끄는 일이다 → 정본으로 갱신.
    it('저장된 값은 반영되고 미지값(오타)은 BLOCK 으로 잠긴다(fail-closed)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: { MEDICATION: 'BLOCK', LAB: 'HACK', IMAGING: 'off ', DIET: 'warn' } });
      const p = await svc.getPolicy();
      expect(p.MEDICATION).toBe('BLOCK');
      expect(p.LAB).toBe('BLOCK');       // 미지값 → 잠근다
      expect(p.IMAGING).toBe('OFF');     // 공백/대소문자만 다른 명시적 완화는 그대로 인정
      expect(p.DIET).toBe('WARN');
      expect(p.NURSING).toBe('OFF');     // 키 부재 = 미설정 = OFF(맵형 게이트 등록 기본)
    });

    it('잘못된 영역/모드 설정은 거부한다', async () => {
      await expect(svc.setPolicy(U, { NOPE: 'WARN' })).rejects.toThrow(BadRequestException);
      await expect(svc.setPolicy(U, { MEDICATION: 'MAYBE' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('상태 batch(code-search 소비)', () => {
    it('REMOVED는 제외하고 codeId→status 맵을 만든다', async () => {
      prisma.formularyItem.findMany.mockResolvedValue([
        { codeId: 'a', status: 'ACTIVE' },
        { codeId: 'b', status: 'SUSPENDED' },
      ]);
      const m = await svc.statusFor(['a', 'b', 'c']);
      expect(m.get('a')).toBe('ACTIVE');
      expect(m.get('b')).toBe('SUSPENDED');
      expect(m.has('c')).toBe(false);
      expect(prisma.formularyItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: { not: 'REMOVED' } }) }),
      );
    });

    it('빈 입력은 빈 맵', async () => {
      expect((await svc.statusFor([])).size).toBe(0);
    });

    it('domain 지정 시 where에 domain 필터가 포함된다(교차 도메인 오배지 방지)', async () => {
      await svc.statusFor(['a'], 'LAB');
      expect(prisma.formularyItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ domain: 'LAB' }) }),
      );
    });

    it('statusByIds는 비UUID를 400으로 거부한다', async () => {
      await expect(svc.statusByIds(['not-a-uuid'])).rejects.toThrow(BadRequestException);
    });

    it('statusByIds는 UUID만 통과시킨다', async () => {
      prisma.formularyItem.findMany.mockResolvedValue([]);
      const r = await svc.statusByIds(['3f2504e0-4f89-41d3-9a0c-0305e82c3301']);
      expect(r).toEqual({});
    });
  });
});
