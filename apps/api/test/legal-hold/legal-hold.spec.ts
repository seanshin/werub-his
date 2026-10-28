import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LegalHoldService, isActiveHold } from '../../src/modules/legal-hold/legal-hold.service';
import { ApprovalService } from '../../src/modules/credential-admin/approval.service';

/**
 * 🔴 법적 보존명령(legal hold) — 상용 릴리즈 T10-7 (2026-09-13).
 *
 * 소송·분쟁·수사로 보존해야 하는 기록의 파기·익명화·(향후) 아카이브 이동을 막는 표시가
 * 스크라이브 세션 1곳에만 있었다. 이 가드가 못박는 것:
 *   ① 활성 여부는 **해제 기록 유무로만** 파생된다 — 다른 필드를 바꿔 조용히 풀 수 없다.
 *   ② 해제는 **4-eyes** — 요청자=승인자 거부(엔진) · **설정자=승인자 거부**(이 모듈) · 승인 없이 실행 거부.
 *   ③ **사유 없는 해제 거부**(공백 제외 5자 미만).
 *   ④ `isHeld()` 는 **조회 실패 시 보존 중(true)** — 모름을 없음으로 번역하지 않는다(파기 경로의 fail-closed).
 *   ⑤ 경로의 환자와 보존명령의 환자가 다르면 거부(감사가 경로의 마지막 UUID=환자에 귀속되므로).
 *   ⑥ 스키마↔마이그레이션 · append-only 트리거가 마이그레이션에 있다.
 *
 * 🔴 ApprovalService 는 **목(mock)이 아니라 실물**을 쓴다 — 4-eyes 규칙이 엔진 안에 있어, 목으로 바꾸면 가드가 헛돈다.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const SETTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUESTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APPROVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** 필요한 최소 동작만 가진 인메모리 Prisma — 실제 반환 모양(release 포함 include)을 따른다 */
function fakePrisma() {
  const holds: any[] = [];
  const releases: any[] = [];
  const approvals: any[] = [];
  let seq = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const withRelease = (h: any) => (h ? { ...h, release: releases.find((r) => r.holdId === h.id) ?? null } : null);
  const matchApproval = (a: any, w: any) =>
    (!w.id || a.id === w.id) &&
    (!w.action || a.action === w.action) &&
    (!w.targetId || a.targetId === w.targetId) &&
    (!w.status || a.status === w.status) &&
    (!w.expiresAt?.gt || a.expiresAt > w.expiresAt.gt);
  const prisma: any = {
    patient: { findUnique: async ({ where }: any) => ([P1, P2].includes(where.id) ? { id: where.id } : null) },
    legalHold: {
      create: async ({ data }: any) => {
        const row = { id: uuid(), scope: 'ALL', basis: null, setAt: new Date(), ...data };
        holds.push(row);
        return withRelease(row);
      },
      findUnique: async ({ where }: any) => withRelease(holds.find((h) => h.id === where.id)),
      findMany: async ({ where }: any = {}) => holds.filter((h) => !where?.patientId || h.patientId === where.patientId).map(withRelease),
      count: async ({ where }: any) =>
        holds.filter((h) => h.patientId === where.patientId && (where.release?.is === null ? !releases.some((r) => r.holdId === h.id) : true)).length,
    },
    legalHoldRelease: {
      create: async ({ data }: any) => {
        if (releases.some((r) => r.holdId === data.holdId)) throw new Error('unique hold_id');
        const row = { id: uuid(), releasedAt: new Date(), ...data };
        releases.push(row);
        return row;
      },
    },
    adminApproval: {
      findFirst: async ({ where }: any) => approvals.filter((a) => matchApproval(a, where)).at(-1) ?? null,
      findUnique: async ({ where }: any) => approvals.find((a) => a.id === where.id) ?? null,
      findMany: async ({ where }: any = {}) => approvals.filter((a) => !where?.status || a.status === where.status),
      create: async ({ data }: any) => {
        const row = { id: uuid(), requestedAt: new Date(), decidedAt: null, approvedBy: null, ...data };
        approvals.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(approvals.find((a) => a.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const hit = approvals.filter((a) => matchApproval(a, where));
        hit.forEach((a) => Object.assign(a, data));
        return { count: hit.length };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  return { prisma, holds, releases, approvals };
}

describe('🔴 법적 보존명령 — 막는 쪽은 빠르게, 푸는 쪽은 4-eyes', () => {
  let db: ReturnType<typeof fakePrisma>;
  let svc: LegalHoldService;

  beforeEach(() => {
    db = fakePrisma();
    svc = new LegalHoldService(db.prisma, new ApprovalService(db.prisma));
  });

  it('① 설정 직후 활성이고 isHeld 가 true — 다른 환자는 false(대조군)', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '의료분쟁 조정 신청' }, SETTER);
    expect(isActiveHold(h)).toBe(true);
    expect(await svc.isHeld(P1)).toBe(true);
    expect(await svc.isHeld(P2)).toBe(false);
  });

  it('① 🔴 활성 판정은 해제 기록만 본다 — 다른 필드를 바꿔도 활성이 뒤집히지 않는다', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '수사기관 보존 요청' }, SETTER);
    // 사유·범위·설정자를 바꿔도(트리거가 막는 조작을 흉내) 해제 기록이 없으면 여전히 활성
    Object.assign(db.holds[0], { reason: '', scope: 'NONE', setBy: APPROVER });
    const listed = await svc.list({ patientId: P1 });
    expect(listed[0].active).toBe(true);
    expect(await svc.isHeld(P1)).toBe(true);
    expect(isActiveHold({ release: null })).toBe(true);
    expect(isActiveHold({ release: { id: 'x' } as any })).toBe(false);
    expect(h.id).toBeTruthy();
  });

  it('② 🔴 요청자 = 승인자 해제 승인은 거부된다(엔진)', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '소송' }, SETTER);
    const a = await svc.requestRelease(h.id, P1, REQUESTER, '분쟁 종결 확인');
    await expect(svc.approveRelease(a.id, P1, REQUESTER)).rejects.toThrow(/4-eyes/);
  });

  it('② 🔴 설정자 = 승인자 해제 승인은 거부된다(이 모듈이 추가 강제)', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '소송' }, SETTER);
    const a = await svc.requestRelease(h.id, P1, REQUESTER, '분쟁 종결 확인');
    await expect(svc.approveRelease(a.id, P1, SETTER)).rejects.toThrow(/건 사람/);
  });

  it('② 🔴 승인 없이 해제 실행은 거부 — 보존은 유지된다', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '소송' }, SETTER);
    await svc.requestRelease(h.id, P1, REQUESTER, '분쟁 종결 확인');
    await expect(svc.executeRelease(h.id, P1, APPROVER)).rejects.toThrow(/4-eyes|승인/);
    expect(await svc.isHeld(P1)).toBe(true);
    expect(db.releases).toHaveLength(0);
  });

  it('② 대조군 — 정상 4-eyes 경로는 해제된다(성공을 실패로 말하지 않는다)', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '소송' }, SETTER);
    const a = await svc.requestRelease(h.id, P1, REQUESTER, '분쟁 종결 확인');
    await svc.approveRelease(a.id, P1, APPROVER);
    const r = await svc.executeRelease(h.id, P1, APPROVER);
    expect(r).toMatchObject({ holdId: h.id, requestedBy: REQUESTER, approvedBy: APPROVER, reason: '분쟁 종결 확인' });
    expect(await svc.isHeld(P1)).toBe(false);
    // 승인은 한 번만 쓸 수 있다
    await expect(svc.executeRelease(h.id, P1, APPROVER)).rejects.toThrow();
  });

  it('③ 🔴 사유 없는(짧은) 해제 요청은 거부된다', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '소송' }, SETTER);
    await expect(svc.requestRelease(h.id, P1, REQUESTER, '')).rejects.toThrow(/사유/);
    await expect(svc.requestRelease(h.id, P1, REQUESTER, '   종결  ')).rejects.toThrow(/사유/);
    expect(db.approvals).toHaveLength(0);
  });

  it('④ 🔴 isHeld 는 조회 실패 시 true(보존 중) — 파기 경로에서 모름을 없음으로 번역하지 않는다', async () => {
    db.prisma.legalHold.count = async () => {
      throw new Error('db down');
    };
    expect(await svc.isHeld(P1)).toBe(true);
  });

  it('⑤ 🔴 경로의 환자와 보존명령의 환자가 다르면 거부(엉뚱한 환자 이력에 감사가 남지 않게)', async () => {
    const h = await svc.setHold({ patientId: P1, reason: '소송' }, SETTER);
    await expect(svc.requestRelease(h.id, P2, REQUESTER, '분쟁 종결 확인')).rejects.toThrow(/환자/);
  });

  it('설정 — 존재하지 않는 환자·빈 사유는 거부', async () => {
    await expect(svc.setHold({ patientId: '99999999-9999-4999-8999-999999999999', reason: '소송' }, SETTER)).rejects.toThrow(/환자/);
    await expect(svc.setHold({ patientId: P1, reason: '  ' }, SETTER)).rejects.toThrow(/사유/);
  });
});

describe('🔴 스키마·마이그레이션 — append-only 가 DB 에 박혀 있다', () => {
  const API = join(__dirname, '../..');
  const schema = readFileSync(join(API, 'prisma/schema.prisma'), 'utf8');
  const mig = readFileSync(join(API, 'prisma/migrations/20260913000002_legal_hold/migration.sql'), 'utf8');

  it('⑥ 모델에 상태 컬럼이 없다 — 활성은 해제 행으로만 파생', () => {
    const block = schema.match(/^model LegalHold \{([\s\S]*?)^\}/m)?.[1] ?? '';
    expect(block, 'LegalHold 모델 파싱').toMatch(/patientId/);
    expect(block).not.toMatch(/^\s+(status|active|isActive|releasedAt)\s/m);
  });

  it('⑥ 마이그레이션이 두 테이블과 UPDATE/DELETE 거부 트리거를 담는다', () => {
    expect(mig).toMatch(/CREATE TABLE "legal_holds"/);
    expect(mig).toMatch(/CREATE TABLE "legal_hold_releases"/);
    expect(mig).toMatch(/CREATE UNIQUE INDEX "legal_hold_releases_hold_id_key"/);
    expect(mig).toMatch(/BEFORE UPDATE OR DELETE ON "legal_holds"/);
    expect(mig).toMatch(/BEFORE UPDATE OR DELETE ON "legal_hold_releases"/);
  });

  it('권한은 최소 — 관리자·의무기록사만', () => {
    const ctl = readFileSync(join(API, 'src/modules/legal-hold/legal-hold.controller.ts'), 'utf8');
    const roles = ctl.match(/@Roles\(([^)]*)\)/)?.[1] ?? '';
    expect(roles.split(',').map((s) => s.trim()).sort()).toEqual(['UserRole.ADMIN', 'UserRole.MEDICAL_RECORDS']);
  });

  it('🔴 변이 경로는 전부 환자로 끝난다 — 감사가 경로의 마지막 UUID(=환자)에 귀속', () => {
    const ctl = readFileSync(join(API, 'src/modules/legal-hold/legal-hold.controller.ts'), 'utf8');
    const posts = [...ctl.matchAll(/@Post\('([^']+)'\)/g)].map((m) => m[1]);
    expect(posts.length).toBe(4);
    for (const p of posts) expect(p, `${p} 는 :patientId 로 끝나야 한다`).toMatch(/patients\/:patientId(\/[a-z-]+)?$/);
    for (const p of posts) {
      const params = [...p.matchAll(/:(\w+)/g)].map((m) => m[1]);
      expect(params.at(-1), `${p} 의 마지막 UUID 파라미터`).toBe('patientId');
    }
  });
});
