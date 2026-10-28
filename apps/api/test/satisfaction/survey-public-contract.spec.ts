import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SatisfactionService } from '../../src/modules/satisfaction/satisfaction.service';

/**
 * 공개 설문 표면 계약 — `/api/v1/public/survey/:token` (무인증·SMS/포털 링크).
 *
 * 토큰이 유일한 문턱이다. (1) 없는 토큰=404 (2) 완료/만료된 설문은 **상태만** 반환하고
 * 환자명·문항을 다시 내주지 않는다(제출 후 링크 재열람으로 PHI 재노출 금지).
 */

function makeSvc(dispatch: unknown) {
  const prisma = { surveyDispatch: { findUnique: vi.fn().mockResolvedValue(dispatch) } };
  return new SatisfactionService({} as never, prisma as never);
}

const PENDING = {
  token: 't1', status: 'PENDING', templateName: '외래 만족도',
  patientName: '홍길동', department: '순환기내과',
  questions: [{ id: 'q1', type: 'likert5', text: '만족하십니까?' }],
  expiresAt: new Date(Date.now() + 60_000),
};

describe('SatisfactionService.getByToken (공개 설문)', () => {
  it('없는 토큰 — 404(존재 오라클 없음)', async () => {
    await expect(makeSvc(null).getByToken('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PENDING — 문항·환자명 반환(토큰 보유자=본인)', async () => {
    const r = await makeSvc(PENDING).getByToken('t1') as Record<string, unknown>;
    expect(r.status).toBe('PENDING');
    expect(r.questions).toBeDefined();
  });

  it('🔴 COMPLETED — 상태·템플릿명만, 문항·환자명 재노출 금지', async () => {
    const r = await makeSvc({ ...PENDING, status: 'COMPLETED' }).getByToken('t1') as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['status', 'templateName'].sort());
    expect(r).not.toHaveProperty('questions');
    expect(r).not.toHaveProperty('patientName');
  });

  it('🔴 만료 — EXPIRED 상태만(문항 미반환)', async () => {
    const r = await makeSvc({ ...PENDING, expiresAt: new Date(Date.now() - 60_000) }).getByToken('t1') as Record<string, unknown>;
    expect(r.status).toBe('EXPIRED');
    expect(r).not.toHaveProperty('questions');
    expect(r).not.toHaveProperty('patientName');
  });
});
