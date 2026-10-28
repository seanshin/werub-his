/**
 * 🔴 의뢰서 — 협진 정본(Consultation)은 **초안이 아니라 서명 단계에서** 생긴다(P0-B · 2026-09-09).
 *
 * 실측 배경: `generateDraft()` 가 `consultation.create({ reason: <LLM 초안>, status: 'REQUESTED' })`
 * 를 불러, 의사가 AI 초안 버튼을 누른 것만으로 타과 협진 목록에 의뢰가 **접수**돼 있었다.
 * 사람 승인 게이트가 없었고, 초안을 버려도 협진은 남았다.
 *
 * 목(mock)은 정본의 실제 반환 모양을 쓴다 — `ConsultationService.create()` 는 생성된 협진 객체를
 * 돌려주고(알림은 그 안에서 fire-and-forget), `medicalAi.enhancedChat()` 은 `{ answer, model_used }` 다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  ReferralLetterService,
  REFERRAL_DRAFT_PROMPT_VERSION,
} from '../../src/modules/referral-letter/referral-letter.service';

describe('ReferralLetterService — 초안≠확정', () => {
  let service: ReferralLetterService;
  let prisma: any;
  let ai: any;
  let consultation: any;
  let aiProposal: any;

  const draftLetter = {
    id: 'letter-1',
    type: 'CONSULTATION_REQUEST',
    consultationId: null,
    encounterId: 'enc-1',
    patientId: 'pat-1',
    fromDepartment: '내과',
    fromDoctorId: 'doc-1',
    toDepartment: '외과',
    toDoctorId: null,
    urgency: 'ROUTINE',
    content: '의뢰 사유 본문',
    // AI 가 낸 원본 — 서명본(content)과 같으면 ACCEPTED, 다르면 EDITED
    aiDraftContent: '의뢰 사유 본문',
    status: 'DRAFT',
    signedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    patient: { familyName: '홍', givenName: '길동' },
  };

  beforeEach(() => {
    prisma = {
      referralLetter: {
        findUnique: vi.fn().mockResolvedValue(draftLetter),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'letter-1', ...data })),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...draftLetter, ...data })),
        // 🔴 (D1) 상태 전이(폐기·거절)는 조건부 updateMany 로 쓴다 — 목도 그 모양을 따른다
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      consultation: { create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      user: { findUnique: vi.fn().mockResolvedValue({ department: '내과' }) },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '홍', givenName: '길동', mrn: 'M1', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' }) },
      encounter: { findUnique: vi.fn().mockResolvedValue(null) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
      labResult: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      preVisitVitals: { findFirst: vi.fn().mockResolvedValue(null) },
      admission: { findFirst: vi.fn().mockResolvedValue(null) },
      problemList: { findMany: vi.fn().mockResolvedValue([]) },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      // 🔴 제안 조회는 이 서비스가 prisma 로 직접 읽는다(AiProposalService 에 대상 조회가 없다) —
      //    목도 그 사실을 그대로 반영한다(내가 가정한 모양이 아니라 실제 호출 형태).
      aiProposal: { findFirst: vi.fn().mockResolvedValue({ id: 'prop-1' }) },
    };
    // 🔴 (2026-09-16 J1) 전송·서명전송은 상태 전이와 수신과 알림이 한 트랜잭션이다(알림이 조용히
    //    사라지면 상태 검사가 재전송을 막아 수신과가 영영 모른다). 목도 콜백을 실제로 돌린다.
    prisma.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
    ai = { enhancedChat: vi.fn().mockResolvedValue({ answer: '[의뢰 사유]\n협진을 요청드립니다. 경과 관찰 중입니다.', model_used: 'weru-b' }) };
    consultation = { create: vi.fn().mockResolvedValue({ id: 'consult-1' }) };
    // 목은 정본의 실제 반환 모양 — create() 는 생성된 제안 행, decide() 는 { proposal, editDistance, ... }
    aiProposal = {
      create: vi.fn().mockResolvedValue({ id: 'prop-1', status: 'GENERATED' }),
      decide: vi.fn().mockResolvedValue({
        proposal: { id: 'prop-1', status: 'ACCEPTED' },
        editDistance: 0,
        editDistanceCapped: false,
        notPresented: false,
      }),
    };

    service = new ReferralLetterService(prisma, ai as any, consultation as any, aiProposal as any);
  });

  describe('generateDraft', () => {
    it('🔴 초안 생성은 협진(Consultation)을 만들지 않는다', async () => {
      await service.generateDraft(
        { type: 'CONSULTATION_REQUEST', patientId: 'pat-1', encounterId: 'enc-1', toDepartment: '외과' } as any,
        'doc-1',
      );

      expect(consultation.create).not.toHaveBeenCalled();
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });

    it('의뢰서는 DRAFT 로 저장되고 AI 원본이 동결된다', async () => {
      await service.generateDraft(
        { type: 'CONSULTATION_REQUEST', patientId: 'pat-1', encounterId: 'enc-1', toDepartment: '외과' } as any,
        'doc-1',
      );

      const data = prisma.referralLetter.create.mock.calls[0][0].data;
      expect(data.status).toBe('DRAFT');
      expect(data.consultationId).toBeNull();
      expect(data.aiDraftContent).toBe(data.content);
      expect(data.aiModel).toBe('weru-b');
    });

    it('이미 지정된 consultationId 는 그대로 붙는다(기존 협진에 쓰는 경로)', async () => {
      await service.generateDraft(
        { type: 'CONSULTATION_REQUEST', patientId: 'pat-1', encounterId: 'enc-1', consultationId: 'consult-old', toDepartment: '외과' } as any,
        'doc-1',
      );

      expect(prisma.referralLetter.create.mock.calls[0][0].data.consultationId).toBe('consult-old');
      expect(consultation.create).not.toHaveBeenCalled();
    });
  });

  describe('sign / signAndSend — 사람 승인 게이트', () => {
    it('🔴 서명하면 협진 정본이 생기고 의뢰서에 연결된다', async () => {
      const r = await service.sign('letter-1', 'doc-1');

      expect(consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          encounterId: 'enc-1',
          requestingDoctorId: 'doc-1',
          toDepartment: '외과',
          reason: '의뢰 사유 본문',
          urgency: 'ROUTINE',
        }),
      );
      expect(prisma.referralLetter.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'letter-1' }, data: { consultationId: 'consult-1' } }),
      );
      expect((r as { consultationId: string | null }).consultationId).toBe('consult-1');
    });

    it('signAndSend 도 같은 게이트를 지난다', async () => {
      await service.signAndSend('letter-1', 'doc-1');
      expect(consultation.create).toHaveBeenCalledTimes(1);
    });

    it('진료(Encounter) 미연결이면 협진을 지어내지 않고 consultationId 는 null 로 남는다', async () => {
      prisma.referralLetter.findUnique.mockResolvedValue({ ...draftLetter, encounterId: null });

      const r = await service.sign('letter-1', 'doc-1');

      expect(consultation.create).not.toHaveBeenCalled();
      expect((r as { consultationId: string | null }).consultationId).toBeNull();
    });

    it('협진 생성이 실패해도 서명은 되돌아가지 않는다(연결만 null)', async () => {
      consultation.create.mockRejectedValueOnce(new Error('boom'));

      const r = await service.sign('letter-1', 'doc-1');

      expect((r as { status: string }).status).toBe('SIGNED');
      expect((r as { consultationId: string | null }).consultationId).toBeNull();
    });

    it('이미 붙은 협진이 있으면 새로 만들지 않고 본문만 동기화한다', async () => {
      prisma.referralLetter.findUnique.mockResolvedValue({ ...draftLetter, consultationId: 'consult-old' });

      await service.sign('letter-1', 'doc-1');

      expect(consultation.create).not.toHaveBeenCalled();
      expect(prisma.consultation.update).toHaveBeenCalledWith({
        where: { id: 'consult-old' },
        data: { reason: '의뢰 사유 본문' },
      });
    });

    it('DRAFT 가 아니면 서명할 수 없다', async () => {
      prisma.referralLetter.findUnique.mockResolvedValue({ ...draftLetter, status: 'SENT' });
      await expect(service.sign('letter-1', 'doc-1')).rejects.toThrow(ForbiddenException);
    });
  });

  /**
   * P1 — AI 제안 원장(AiProposal). 정본은 여전히 `ReferralLetter` 고, 제안은 **옆에** 남는다.
   * 🔴 `ReferralLetter` 에 컬럼을 추가하지 않는다 — 잇는 것은 `targetType + targetId` 뿐이다.
   */
  describe('AI 제안 원장 — 초안 생성', () => {
    const gen = () =>
      service.generateDraft(
        { type: 'CONSULTATION_REQUEST', patientId: 'pat-1', encounterId: 'enc-1', toDepartment: '외과' } as any,
        'doc-1',
      );

    it('🔴 초안을 만들면 제안 1건이 생기고 letter 응답에 proposalId 가 실린다', async () => {
      const letter = await gen();

      expect(aiProposal.create).toHaveBeenCalledTimes(1);
      const arg = aiProposal.create.mock.calls[0][0];
      expect(arg.kind).toBe('REFERRAL_DRAFT');
      expect(arg.targetType).toBe('ReferralLetter');
      expect(arg.targetId).toBe('letter-1');
      expect(arg.patientId).toBe('pat-1');
      expect(arg.source).toBe('AI');
      expect(arg.createdBy).toBe('doc-1');
      expect(arg.promptVersion).toBe(REFERRAL_DRAFT_PROMPT_VERSION);
      // 본문은 letter 에 저장된 AI 원본과 같은 글이어야 한다(다르면 편집거리가 처음부터 거짓이 된다)
      expect(arg.content).toBe(prisma.referralLetter.create.mock.calls[0][0].data.aiDraftContent);
      // 입력 스냅샷은 해시로만 — 본문(PHI)을 담지 않는다
      expect(arg.inputSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect((letter as { proposalId: string | null }).proposalId).toBe('prop-1');
    });

    it('상류가 준 모델 태그만 modelRef 로 남는다', async () => {
      await gen();
      expect(aiProposal.create.mock.calls[0][0].modelRef).toBe('weru-b');
    });

    it("🔴 modelRef 가 'unknown' 이면 null — 모델 이름을 지어내지 않는다", async () => {
      // 상류가 모델을 밝히지 않은 응답(`model_used` 없음) → 서비스가 'unknown' 으로 채우던 자리
      ai.enhancedChat.mockResolvedValueOnce({ answer: '[의뢰 사유]\n협진을 요청드립니다. 경과 관찰 중입니다.' });

      await gen();

      expect(prisma.referralLetter.create.mock.calls[0][0].data.aiModel).toBe('unknown');
      expect(aiProposal.create.mock.calls[0][0].modelRef).toBeNull();
    });

    it('🔴 AI 가 못 답해 규칙 서식으로 떨어지면 source=FALLBACK 이고 modelRef 는 null 이다', async () => {
      ai.enhancedChat.mockRejectedValueOnce(new Error('AI down'));

      await gen();

      const arg = aiProposal.create.mock.calls[0][0];
      expect(arg.source).toBe('FALLBACK');
      expect(arg.modelRef).toBeNull();
    });

    it('제안 기록이 실패해도 초안 생성은 성공하고 proposalId 는 null 로 말한다', async () => {
      aiProposal.create.mockRejectedValueOnce(new Error('ledger down'));

      const letter = await gen();

      expect((letter as { proposalId: string | null }).proposalId).toBeNull();
      expect(prisma.referralLetter.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('AI 제안 원장 — 서명이 사람 결정이다', () => {
    it('🔴 서명본이 AI 원본과 같으면 ACCEPTED', async () => {
      const r = await service.sign('letter-1', 'doc-1');

      expect(prisma.aiProposal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetType: 'ReferralLetter', targetId: 'letter-1' }),
        }),
      );
      expect(aiProposal.decide).toHaveBeenCalledWith('prop-1', {
        decision: 'ACCEPTED',
        actorId: 'doc-1',
        finalText: '의뢰 사유 본문',
      });
      expect((r as any).aiProposal).toEqual({ id: 'prop-1', decision: 'ACCEPTED', recorded: true });
    });

    it('🔴 의사가 고쳤으면 EDITED — 최종본만 넘기고 수정량은 서버(decide)가 잰다', async () => {
      prisma.referralLetter.findUnique.mockResolvedValue({
        ...draftLetter,
        aiDraftContent: 'AI 가 쓴 원본',
        content: '의사가 고친 본문',
      });

      await service.sign('letter-1', 'doc-1');

      expect(aiProposal.decide).toHaveBeenCalledWith('prop-1', {
        decision: 'EDITED',
        actorId: 'doc-1',
        finalText: '의사가 고친 본문',
      });
    });

    it('signAndSend 도 같은 결정을 남긴다(경로가 둘인데 한쪽만 기록하면 수용률이 갈라진다)', async () => {
      const r = await service.signAndSend('letter-1', 'doc-1');

      expect(aiProposal.decide).toHaveBeenCalledTimes(1);
      expect((r as any).aiProposal.decision).toBe('ACCEPTED');
    });

    it('🔴 제안 기록이 실패해도 서명은 되돌아가지 않는다(recorded=false 로 말한다)', async () => {
      aiProposal.decide.mockRejectedValueOnce(new Error('ledger down'));

      const r = await service.sign('letter-1', 'doc-1');

      expect((r as { status: string }).status).toBe('SIGNED');
      expect((r as any).aiProposal).toEqual(
        expect.objectContaining({ id: 'prop-1', decision: 'ACCEPTED', recorded: false }),
      );
    });

    it('제안이 없으면 aiProposal 은 null — 없는 결정을 "무수정 수용"으로 세지 않는다', async () => {
      prisma.aiProposal.findFirst.mockResolvedValue(null);

      const r = await service.sign('letter-1', 'doc-1');

      expect(aiProposal.decide).not.toHaveBeenCalled();
      expect((r as any).aiProposal).toBeNull();
    });
  });

  describe('AI 제안 원장 — 폐기는 거부다(만료가 아니다)', () => {
    it('🔴 의뢰서를 폐기하면 제안은 REJECTED + LETTER_DISCARDED', async () => {
      const r = await service.voidLetter('letter-1', 'doc-1', '중복 작성');

      expect(aiProposal.decide).toHaveBeenCalledWith('prop-1', {
        decision: 'REJECTED',
        actorId: 'doc-1',
        reason: 'LETTER_DISCARDED · 중복 작성',
      });
      expect((r as any).aiProposal.recorded).toBe(true);
    });

    it('폐기 사유가 없어도 거부는 기록된다(사유를 강제하지 않는다)', async () => {
      await service.voidLetter('letter-1', 'doc-1', '');

      expect(aiProposal.decide.mock.calls[0][1].reason).toBe('LETTER_DISCARDED');
    });
  });
});
