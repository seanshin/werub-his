import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  MdtService,
  MDT_DECISION_CATEGORIES,
  MDT_DECISION_CATEGORY_LABEL,
} from '../../src/modules/mdt/mdt.service';

/**
 * MDT 결정 기록 **정본 가드**(화면 실사용 점검 W7 ①②).
 *
 * 🔴 종전 결함
 *   - 결정 입력 폼이 `decisionCategory: 'OBSERVATION'`(경과관찰=무치료)을 프리필했고,
 *     서버엔 enum 검증조차 없어 의사가 고르지 않은 무치료 결정이 임상 기록으로 남았다(P15).
 *   - 통계 응답은 객체 맵인데 화면이 배열로 알고 `.map()` 을 불러 탭이 통째 크래시했다(P11).
 */
describe('MDT 결정 분류·통계 계약 가드', () => {
  let service: MdtService;
  let mockPrisma: any;
  let mockJourney: any;

  const mockCase = {
    id: 'case-1',
    conferenceId: 'conf-1',
    patientId: 'pat-1',
    primaryDiag: 'C34.1',
    decision: null,
    decisionCategory: null,
  };

  beforeEach(() => {
    mockPrisma = {
      mdtConference: { findUnique: vi.fn().mockResolvedValue({ department: '종양내과', title: '폐암 MDT' }), count: vi.fn(), groupBy: vi.fn() },
      mdtCase: { findUnique: vi.fn().mockResolvedValue(mockCase), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
      patientJourneyEvent: { create: vi.fn().mockResolvedValue({}) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    // 3번째 인자는 AI 제안 원장(AiProposalService) — 이 스펙의 경로(사람 결정 기록)는 부르지 않는다
    // 4번째 인자 = 여정 정본 발행기(2026-10-01 여정 P0-6 — 종전 prisma 직접 쓰기)
    mockJourney = { emit: vi.fn() };
    service = new MdtService(mockPrisma, {} as any, {} as any, mockJourney);
  });

  it('정본 목록은 미분류(UNCLASSIFIED)를 포함하고, 각 코드에 한글 라벨이 있다', () => {
    expect(MDT_DECISION_CATEGORIES).toContain('UNCLASSIFIED');
    expect(MDT_DECISION_CATEGORIES).toContain('OBSERVATION');
    for (const c of MDT_DECISION_CATEGORIES) {
      expect(MDT_DECISION_CATEGORY_LABEL[c]).toBeTruthy();
    }
    // '미분류'와 '경과관찰'은 다른 임상 사실이다 — 라벨이 같아지면 화면에서 구분이 사라진다
    expect(MDT_DECISION_CATEGORY_LABEL.UNCLASSIFIED).not.toBe(MDT_DECISION_CATEGORY_LABEL.OBSERVATION);
  });

  it.each(MDT_DECISION_CATEGORIES)('정본 분류 %s 는 저장된다', async (category) => {
    mockPrisma.mdtCase.update.mockResolvedValue({ ...mockCase, decision: '기록', decisionCategory: category });

    await service.updateCase('case-1', { decision: '기록', decisionCategory: category });

    expect(mockPrisma.mdtCase.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: expect.objectContaining({ decisionCategory: category }),
    });
  });

  it.each(['', null])('빈 값(%s)은 null(미기록)로 남는다 — 임의 분류로 채우지 않는다', async (empty) => {
    mockPrisma.mdtCase.update.mockResolvedValue({ ...mockCase, decision: '기록' });

    await service.updateCase('case-1', { decision: '기록', decisionCategory: empty });

    expect(mockPrisma.mdtCase.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: expect.objectContaining({ decisionCategory: null }),
    });
  });

  it.each(['obs', 'OBSERVATION ', 'CHEMO_THEN_SURGERY', 'DROP TABLE', 123 as unknown as string])(
    '정본에 없는 값(%s)은 400 으로 거부한다',
    async (bogus) => {
      await expect(
        service.updateCase('case-1', { decision: '기록', decisionCategory: bogus }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.mdtCase.update).not.toHaveBeenCalled();
    },
  );

  it('여정 타임라인 제목은 코드가 아니라 한글 라벨을 쓴다', async () => {
    mockPrisma.mdtCase.update.mockResolvedValue({ ...mockCase, decision: '수술 시행', decisionCategory: 'SURGERY' });

    await service.updateCase('case-1', { decision: '수술 시행', decisionCategory: 'SURGERY' });

    expect(mockJourney.emit).toHaveBeenCalledWith(
      expect.objectContaining({ title: '다학제(MDT) 결정: 수술', refType: 'MDT_CASE', refId: 'case-1' }),
    );
  });

  it('통계 byStatus/byDecisionCategory 는 객체 맵이다 (배열로 바뀌면 화면이 죽는다)', async () => {
    mockPrisma.mdtConference.count.mockResolvedValue(0);
    mockPrisma.mdtConference.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: 2 }]);
    mockPrisma.mdtCase.groupBy.mockResolvedValue([{ decisionCategory: null, _count: 3 }]);
    mockPrisma.mdtCase.count.mockResolvedValue(3);

    const stats = await service.getStats();

    expect(Array.isArray(stats.byStatus)).toBe(false);
    expect(Array.isArray(stats.byDecisionCategory)).toBe(false);
    expect(stats.byStatus.COMPLETED).toBe(2);
    // 분류 미기록은 'UNRECORDED' — 무치료 결정(OBSERVATION)으로 흘려보내지 않는다
    expect(stats.byDecisionCategory.UNRECORDED).toBe(3);
    expect(stats.byDecisionCategory.OBSERVATION).toBeUndefined();
    expect(typeof stats.overdueScheduled).toBe('number');
    expect(typeof stats.completedWithoutRecord).toBe('number');
  });
});
