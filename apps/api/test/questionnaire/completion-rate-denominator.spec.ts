import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuestionnaireAdminService } from '../../src/modules/questionnaire/questionnaire-admin.service';

/**
 * 문진 작성률의 분모 0 규약 가드 (W8 이연 회수 · 2026-08-14)
 *
 * 🔴 원 결함: 발송 0건일 때 `completionRate: 0` 을 냈다.
 *    "발송이 한 건도 없다"(아직 아무 일도 안 일어났다)와 "발송했는데 아무도 안 썼다"(작성률 진짜 0%)
 *    는 **다른 사실**인데 화면에는 똑같이 "0%" 로 떴다.
 *    W7/W8 의 다른 EP 는 전부 `null`(산출 불가) 규약이라 여기만 갈라져 있었다(P12).
 *
 * 운영 실측(2026-08-14): questionnaire_tokens = SENT 2 · COMPLETED 0
 *   → 분모 2 > 0 이므로 이건 **진짜 0%** 다. null 이 아니다.
 */
describe('QuestionnaireAdminService.getStats — 분모 0 규약', () => {
  let service: QuestionnaireAdminService;
  let prisma: any;

  const arrange = (total: number, completed: number, expired = 0) => {
    prisma.questionnaireToken.count
      .mockResolvedValueOnce(total)     // total
      .mockResolvedValueOnce(completed) // completed
      .mockResolvedValueOnce(expired)   // expired
      .mockResolvedValueOnce(0)         // todaySent
      .mockResolvedValueOnce(0);        // todayCompleted
    prisma.questionnaireToken.findMany.mockResolvedValue([]);
  };

  beforeEach(() => {
    prisma = { questionnaireToken: { count: vi.fn(), findMany: vi.fn() } };
    service = new QuestionnaireAdminService(prisma);
  });

  it('🔴 발송 0건이면 작성률은 null(산출 불가) — 0% 가 아니다', async () => {
    arrange(0, 0);

    const s = await service.getStats();

    expect(s.completionRate).toBeNull();
    expect(s.completionRate).not.toBe(0);
    expect(s.completionRateUnavailableReason).toContain('표본 0');
  });

  it('🔴 발송은 있는데 작성 0 이면 진짜 0% 다 — null 로 숨기지 않는다(역검증)', async () => {
    arrange(2, 0); // 운영 실측: SENT 2 · COMPLETED 0

    const s = await service.getStats();

    expect(s.completionRate).toBe(0);
    expect(s.completionRate).not.toBeNull();
    expect(s.completionRateUnavailableReason).toBeNull();
  });

  it('정상 표본에서는 소수 1자리 비율을 낸다', async () => {
    arrange(8, 3);

    const s = await service.getStats();

    expect(s.completionRate).toBe(37.5);
    expect(s.completionRateUnavailableReason).toBeNull();
  });

  it('양식별 rate 도 같은 규약을 따른다 — 발송 0 인 양식은 null', async () => {
    prisma.questionnaireToken.count.mockResolvedValue(0);
    prisma.questionnaireToken.findMany.mockResolvedValue([
      { status: 'COMPLETED', formSchema: { name: '초진 문진' } },
      { status: 'SENT', formSchema: { name: '초진 문진' } },
      { status: 'SENT', formSchema: { name: '수술 전 문진' } },
    ]);

    const s = await service.getStats();
    const byForm = s.byDepartment;

    expect(byForm.find(f => f.formName === '초진 문진')?.rate).toBe(50);
    expect(byForm.find(f => f.formName === '수술 전 문진')?.rate).toBe(0); // 표본 1 · 작성 0 = 진짜 0%
  });
});
