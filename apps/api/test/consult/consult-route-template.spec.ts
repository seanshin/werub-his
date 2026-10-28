/**
 * 🔴 (2026-09-14) 상담 부서(팀) 큐 이관·빠른답변 템플릿 — 기획 portal-chat-consultation FR-05·FR-12.
 * 지키는 것:
 *  이관 ① 비활성·없는 팀 400(CONSULT_ROUTE_TEAM_INVALID) ② 이관 = 팀·분류 갱신 + 이전 담당·팀장 에스컬레이션 해제 + 직원 전용(INTERNAL) 노트 + 감사
 *       ③ 대조군 — 같은 팀·분류면 아무것도 바꾸지 않는다 ④ 자동 분류 없음 — 팀은 호출자가 고른 값 그대로
 *  템플릿 ⑤ 상담원 목록은 공용+내 팀·활성만 ⑥ 팀장이 팀을 비우면 자기 팀(공용으로 조용히 올리지 않음)
 *       ⑦ 팀장의 공용·타 팀 작성·수정 403 ⑧ 🔴 템플릿은 메시지를 만들지 않는다(자동 전송 없음) ⑨ 비활성은 삭제가 아니라 active=false
 *  권한 ⑩ route·템플릿 쓰기는 LEAD 이상, 템플릿 목록은 상담원(AGENT) 이상
 */
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ConsultService } from '../../src/modules/consult/consult.service';
import { ConsultTemplateService } from '../../src/modules/consult/consult-template.service';
import { ConsultStaffController } from '../../src/modules/consult/consult-staff.controller';
import { CONSULT_ROLE_KEY } from '../../src/modules/consult/consult-role.decorator';

function consultSvc(session: Record<string, unknown> | null, team: Record<string, unknown> | null) {
  const prisma = {
    consultSession: { findUnique: vi.fn().mockResolvedValue(session), update: vi.fn().mockResolvedValue({}) },
    consultTeam: { findUnique: vi.fn().mockResolvedValue(team) },
    consultMessage: { create: vi.fn().mockResolvedValue({}) },
    consultAgent: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const svc = Object.create(ConsultService.prototype) as ConsultService;
  Object.assign(svc as any, { prisma, audit, notify: undefined, logger: { warn: vi.fn(), log: vi.fn() }, emit: vi.fn() });
  return { svc, prisma, audit };
}

const S = { id: 's1', teamId: 'team-a', category: 'CHECKUP', assigneeId: 'agent-1', escalatedToId: 'lead-a', leadEscalatedAt: new Date(), escalationReason: 'x' };

describe('상담 부서 큐 이관', () => {
  it('① 비활성 팀이면 400 이고 세션을 바꾸지 않는다', async () => {
    const { svc, prisma } = consultSvc(S, { id: 'team-b', active: false });
    const err = await svc.routeToTeam('s1', 'team-b', 'lead-a').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().domainCode).toBe('CONSULT_ROUTE_TEAM_INVALID');
    expect(prisma.consultSession.update).not.toHaveBeenCalled();
  });

  it('② 이관은 팀·분류를 바꾸고 이전 담당·팀장 에스컬레이션을 해제하며 직원 전용 노트·감사를 남긴다', async () => {
    const { svc, prisma, audit } = consultSvc(S, { id: 'team-b', active: true });
    const r = await svc.routeToTeam('s1', 'team-b', 'lead-a', { category: 'BILLING', reason: '수납 문의' });
    expect(r).toEqual({ ok: true, changed: true });
    expect(prisma.consultSession.update.mock.calls[0][0].data).toMatchObject({
      teamId: 'team-b', category: 'BILLING', assigneeId: null, escalatedToId: null, leadEscalatedAt: null, escalationReason: null,
    });
    const msg = prisma.consultMessage.create.mock.calls[0][0].data;
    expect(msg.visibility).toBe('INTERNAL');
    expect(msg.content).toBe('수납 문의');
    await Promise.resolve();
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.log.mock.calls[0][0].changes)).toContain('CONSULT_ROUTE');
  });

  it('③ 대조군 — 같은 팀·같은 분류면 바꾸지 않는다', async () => {
    const { svc, prisma } = consultSvc(S, { id: 'team-a', active: true });
    const r = await svc.routeToTeam('s1', 'team-a', 'lead-a');
    expect(r).toEqual({ ok: true, changed: false });
    expect(prisma.consultSession.update).not.toHaveBeenCalled();
    expect(prisma.consultMessage.create).not.toHaveBeenCalled();
  });

  it('④ 자동 분류 없음 — 분류를 주지 않으면 기존 분류를 유지한다(추정하지 않는다)', async () => {
    const { svc, prisma } = consultSvc(S, { id: 'team-b', active: true });
    await svc.routeToTeam('s1', 'team-b', 'lead-a');
    expect(prisma.consultSession.update.mock.calls[0][0].data.category).toBe('CHECKUP');
  });
});

function tplSvc(existing: Record<string, unknown> | null = null) {
  const prisma = {
    consultReplyTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'tp1', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'tp1', ...data })),
    },
    consultMessage: { create: vi.fn() },
  };
  return { svc: new ConsultTemplateService(prisma as any), prisma };
}
const LEAD = { userId: 'lead-a', teamId: 'team-a', isAdmin: false };
const ADMIN = { userId: 'adm', teamId: null, isAdmin: true };

describe('빠른답변 템플릿', () => {
  it('⑤ 상담원 목록은 공용+내 팀·활성만', async () => {
    const { svc, prisma } = tplSvc();
    await svc.list(LEAD);
    const where = prisma.consultReplyTemplate.findMany.mock.calls[0][0].where;
    expect(where.active).toBe(true);
    expect(where.OR).toEqual([{ teamId: null }, { teamId: 'team-a' }]);
  });

  it('⑥ 팀장이 팀을 비우면 자기 팀으로 만든다', async () => {
    const { svc, prisma } = tplSvc();
    await svc.create(LEAD, { title: '안내', body: '확인 후 연락드리겠습니다' });
    expect(prisma.consultReplyTemplate.create.mock.calls[0][0].data.teamId).toBe('team-a');
  });

  it('⑦ 팀장의 공용 작성·타 팀 수정은 403 · 대조군 — ADMIN 은 공용 작성 가능', async () => {
    const { svc } = tplSvc({ id: 'tp1', teamId: 'team-b' });
    const e1 = await svc.create(LEAD, { title: 'a', body: 'b', teamId: null }).catch((e) => e);
    expect(e1.getStatus()).toBe(403);
    const e2 = await svc.update(LEAD, 'tp1', { title: 'x' }).catch((e) => e);
    expect(e2.getStatus()).toBe(403);
    await expect(svc.create(ADMIN, { title: 'a', body: 'b', teamId: null })).resolves.toMatchObject({ teamId: null });
  });

  it('⑧ 🔴 템플릿 작성·수정은 상담 메시지를 만들지 않는다(자동 전송 없음)', async () => {
    const { svc, prisma } = tplSvc({ id: 'tp1', teamId: 'team-a' });
    await svc.create(LEAD, { title: 'a', body: 'b' });
    await svc.update(LEAD, 'tp1', { body: 'c' });
    expect(prisma.consultMessage.create).not.toHaveBeenCalled();
  });

  it('⑨ 비활성은 삭제가 아니라 active=false 갱신', async () => {
    const { svc, prisma } = tplSvc({ id: 'tp1', teamId: 'team-a' });
    await svc.deactivate(LEAD, 'tp1');
    expect(prisma.consultReplyTemplate.update.mock.calls[0][0].data).toMatchObject({ active: false, updatedBy: 'lead-a' });
  });
});

describe('권한 메타데이터', () => {
  const role = (h: keyof ConsultStaffController) => new Reflector().get<string>(CONSULT_ROLE_KEY, ConsultStaffController.prototype[h] as any);
  it('⑩ route·템플릿 쓰기·이관 팀 목록은 LEAD, 템플릿 목록은 역할 요구 없음(상담원 등록만)', () => {
    expect(role('route')).toBe('LEAD');
    expect(role('leadTeams')).toBe('LEAD');
    expect(role('createTemplate')).toBe('LEAD');
    expect(role('updateTemplate')).toBe('LEAD');
    expect(role('deactivateTemplate')).toBe('LEAD');
    expect(role('listTemplates')).toBeUndefined();
  });
});
