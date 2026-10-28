/**
 * 🔴 (2026-09-14) 문진표 검토 완료가 상태를 보지 않았다 — 제출 전 문진표도 '검토됨'이 됐고, 두 번째 사람이 누르면 첫 검토자·시각을 덮어썼다.
 * 기획 FR-05-1 `발송됨 → 작성중 → 완료 → 검토됨` · '검토됨' = reviewedAt(+reviewedBy) — status 어휘에 새 값을 만들지 않는다.
 * 지키는 것: ① 없는 id 404 ② 제출 전(SENT·OPENED·IN_PROGRESS·EXPIRED)·제출물 없음 409 QUESTIONNAIRE_NOT_SUBMITTED
 *           ③ 제출 완료 → 조건부(reviewedAt null) 기록 + 검토자 이름 ④ 이미 검토됨 → 덮어쓰지 않음(대조군)
 *           ⑤ 동시 검토 경합(조건부 갱신 0건) → alreadyReviewed ⑥ 컨트롤러 역할(DOCTOR·NURSE·ADMIN)
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { QuestionnaireAdminService } from '../../src/modules/questionnaire/questionnaire-admin.service';
import { QuestionnaireAdminController } from '../../src/modules/questionnaire/questionnaire-admin.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

function make(token: Record<string, unknown> | null, updateCount = 1) {
  const findUnique = vi.fn()
    .mockResolvedValueOnce(token)
    .mockResolvedValueOnce(token ? { ...token, reviewedBy: token.reviewedBy ?? 'u-doc', reviewedAt: token.reviewedAt ?? new Date('2026-09-14T01:00:00Z'), reviewer: { familyName: '김', givenName: '의사' } } : null);
  const updateMany = vi.fn().mockResolvedValue({ count: updateCount });
  const update = vi.fn();
  const prisma = { questionnaireToken: { findUnique, updateMany, update } };
  const svc = new QuestionnaireAdminService(prisma as any, {} as any, {} as any);
  return { svc, findUnique, updateMany, update };
}

describe('문진표 검토 완료 — 상태·소급 금지', () => {
  it('① 없는 id 는 404', async () => {
    const { svc } = make(null);
    await expect(svc.markReviewed('x', 'u')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['SENT', 'OPENED', 'IN_PROGRESS', 'EXPIRED'])('② %s 는 409 이고 기록하지 않는다', async (status) => {
    const { svc, updateMany, update } = make({ id: 't1', status, submissionId: null, reviewedAt: null });
    const err = await svc.markReviewed('t1', 'u').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse().domainCode).toBe('QUESTIONNAIRE_NOT_SUBMITTED');
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('② COMPLETED 인데 제출물이 없으면 409', async () => {
    const { svc, updateMany } = make({ id: 't1', status: 'COMPLETED', submissionId: null, reviewedAt: null });
    await expect(svc.markReviewed('t1', 'u')).rejects.toBeInstanceOf(HttpException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('③ 제출 완료 → reviewedAt null 조건부로 기록하고 검토자 이름을 돌려준다', async () => {
    const { svc, updateMany } = make({ id: 't1', status: 'COMPLETED', submissionId: 's1', reviewedAt: null });
    const r = await svc.markReviewed('t1', 'u-doc');
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 't1', reviewedAt: null, status: 'COMPLETED' });
    expect(arg.data.reviewedBy).toBe('u-doc');
    expect(r).toMatchObject({ alreadyReviewed: false, reviewedBy: 'u-doc', reviewerName: '김의사' });
  });

  it('④ 대조군 — 이미 검토된 문진표는 덮어쓰지 않는다', async () => {
    const first = new Date('2026-09-10T00:00:00Z');
    const { svc, updateMany, update } = make({ id: 't1', status: 'COMPLETED', submissionId: 's1', reviewedAt: first, reviewedBy: 'u-first' });
    const r = await svc.markReviewed('t1', 'u-second');
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(r).toMatchObject({ alreadyReviewed: true, reviewedBy: 'u-first' });
  });

  it('⑤ 동시 검토 경합 — 조건부 갱신이 0건이면 alreadyReviewed', async () => {
    const { svc } = make({ id: 't1', status: 'COMPLETED', submissionId: 's1', reviewedAt: null }, 0);
    const r = await svc.markReviewed('t1', 'u');
    expect(r.alreadyReviewed).toBe(true);
  });

  it('⑥ 검토 EP 역할은 DOCTOR·NURSE·ADMIN', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, QuestionnaireAdminController.prototype.markReviewed as any);
    expect([...roles].sort()).toEqual(['ADMIN', 'DOCTOR', 'NURSE']);
  });
});
