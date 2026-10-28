/**
 * AiProposalService — AI 제안(review-pending) 코어 계약.
 *
 * 🔴 목은 **정본의 실제 반환 모양**을 쓴다. Prisma 는 `create`→행, `updateMany`→`{count}`,
 *    `findUnique`→행|null 을 돌려준다. 내가 가정한 모양을 목에 넣으면 가드가 헛돈다
 *    (수술기록 `ebl` 사례: 단위 테스트는 통과했는데 실파이프는 400 이었다).
 *    그래서 여기 목은 **행을 실제로 보관하는 인메모리 저장소**다 — 상태 전이가 진짜로 반영된다.
 *
 * 🔴 이 스펙이 지키는 사실:
 *    ① 본문은 암호화돼 저장되고 해시는 평문 기준이다
 *    ② 생성과 GENERATED 전이는 같은 트랜잭션이다
 *    ③ 노출 보고는 멱등이고 최초 노출 시각을 덮지 않는다
 *    ④ 결정된 제안은 다시 결정되지 않는다
 *    ⑤ 수정량을 **재지 않은 것**과 **0**을 구분한다
 *    ⑥ 노출 없이 결정한 건은 막지 않되 원장에 그 사실을 남긴다
 *    ⑦ 만료는 GENERATED/PRESENTED 만 — 만료는 거부가 아니다
 *    ⑧ 본문을 update 하는 경로가 소스에 없다
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AiProposalService } from '../../src/modules/ai-proposal/ai-proposal.service';

const ENC_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/i;
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const PATIENT = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';

/** 실제 Prisma 반환 모양을 흉내내는 인메모리 저장소 목 */
function makePrisma() {
  const proposals: any[] = [];
  const transitions: any[] = [];
  let seq = 0;

  const match = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const cond = v as any;
        if ('in' in cond) return cond.in.includes(row[k]);
        if ('lte' in cond || 'not' in cond) {
          if ('not' in cond && cond.not === null && row[k] == null) return false;
          if ('lte' in cond) return row[k] != null && row[k] <= cond.lte;
          return true;
        }
      }
      return row[k] === v;
    });

  const client: any = {
    aiProposal: {
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `prop-${++seq}`,
          targetKey: null,
          patientId: null,
          modelRef: null,
          modelReleaseId: null,
          promptVersion: null,
          inputSnapshotHash: null,
          contentEnc: null,
          confidence: null,
          reasonCode: null,
          version: 1,
          supersedesId: null,
          createdBy: null,
          presentedAt: null,
          decidedAt: null,
          decidedBy: null,
          rejectReason: null,
          editDistance: null,
          expiresAt: null,
          createdAt: new Date('2026-09-09T00:00:00Z'),
          ...data,
        };
        proposals.push(row);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = proposals.find((p) => p.id === where.id);
        if (!row) return null;
        if (include?.transitions) {
          return { ...row, transitions: transitions.filter((t) => t.proposalId === row.id) };
        }
        return { ...row };
      }),
      findMany: vi.fn(async ({ where, take }: any) => {
        const rows = proposals.filter((p) => match(p, where));
        return rows.slice(0, take ?? rows.length).map((r) => ({ ...r }));
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = proposals.filter((p) => match(p, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
    aiProposalTransition: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `tr-${transitions.length + 1}`, at: new Date(), ...data };
        transitions.push(row);
        return { ...row };
      }),
    },
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg))),
    __proposals: proposals,
    __transitions: transitions,
  };
  return client;
}

const baseInput = {
  kind: 'SOAP_DRAFT' as const,
  targetType: 'Encounter',
  targetId: TARGET,
  patientId: PATIENT,
  content: '주호소: 두통. 계획: 경과 관찰.',
  source: 'AI' as const,
  createdBy: ACTOR,
};

describe('AiProposalService', () => {
  let prisma: any;
  let service: AiProposalService;

  beforeEach(() => {
    // 필드 암호화 정본이 요구하는 키 — 테스트 전용 값(실 시크릿 아님)
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'a3f9'.repeat(16);
    prisma = makePrisma();
    service = new AiProposalService(prisma);
  });

  /* ───────── ① 생성 ───────── */

  describe('create', () => {
    it('본문은 암호화해 저장하고 해시는 평문 기준이다 — 암호문이 평문으로 새지 않는다', async () => {
      const p = await service.create(baseInput);
      expect(p.contentEnc, '암호화 형식(iv:tag:cipher)').toMatch(ENC_RE);
      expect(p.contentEnc).not.toContain('두통');
      expect(p.contentHash, '해시는 평문 sha256').toBe(sha256(baseInput.content));
      expect(p.status).toBe('GENERATED');
    });

    it('생성과 GENERATED 전이가 **같은 트랜잭션** 안에서 일어난다(전이 없는 제안이 남지 않는다)', async () => {
      const p = await service.create(baseInput);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.__transitions).toHaveLength(1);
      expect(prisma.__transitions[0]).toMatchObject({
        proposalId: p.id,
        fromStatus: null, // 최초 생성은 이전 상태가 없다
        toStatus: 'GENERATED',
        actorId: ACTOR,
      });
    });

    it('🔴 모델이 신뢰도를 안 주면 null 이다 — 기본값을 만들지 않는다', async () => {
      const p = await service.create(baseInput);
      expect(p.confidence).toBeNull();
      const q = await service.create({ ...baseInput, confidence: 0.42 });
      expect(Number(q.confidence)).toBeCloseTo(0.42, 3);
    });

    it('UUID 가 아닌 대상은 targetKey 없이 받지 않는다 — 대상을 추정하지 않는다', async () => {
      await expect(service.create({ ...baseInput, targetId: null })).rejects.toThrow(/targetKey/);
      const p = await service.create({ ...baseInput, targetId: null, targetKey: 'KCD:I10' });
      expect(p.targetId).toBe('00000000-0000-0000-0000-000000000000');
      expect(p.targetKey).toBe('KCD:I10');
    });

    it('정본에 없는 kind 는 받지 않는다(어휘 정본은 shared 하나)', async () => {
      await expect(service.create({ ...baseInput, kind: 'MADE_UP' as any })).rejects.toThrow(/제안 종류/);
    });
  });

  /* ───────── ③ 노출 보고 ───────── */

  describe('markPresented', () => {
    it('GENERATED→PRESENTED 로 바꾸고 전이 1행을 남긴다', async () => {
      const p = await service.create(baseInput);
      const r = await service.markPresented(p.id, ACTOR, 'chart/soap');
      expect(r.changed).toBe(true);
      expect(r.status).toBe('PRESENTED');
      expect(r.presentedAt).toBeInstanceOf(Date);
      expect(prisma.__transitions.at(-1)).toMatchObject({ fromStatus: 'GENERATED', toStatus: 'PRESENTED', clientContext: 'chart/soap' });
    });

    it('🔴 멱등 — 두 번째 호출은 아무것도 바꾸지 않고 **그 사실을 말한다**(에러도 조용한 성공도 아니다)', async () => {
      const p = await service.create(baseInput);
      const first = await service.markPresented(p.id, ACTOR);
      const second = await service.markPresented(p.id, ACTOR);
      expect(second.changed).toBe(false);
      expect(second.note).toMatch(/이미 PRESENTED/);
      expect(second.presentedAt).toEqual(first.presentedAt); // 최초 노출 시각을 덮지 않는다
      expect(prisma.__transitions.filter((t: any) => t.toStatus === 'PRESENTED')).toHaveLength(1);
    });

    it('없는 제안은 404', async () => {
      await expect(service.markPresented('prop-none')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /* ───────── ④⑤⑥ 결정 ───────── */

  describe('decide', () => {
    it('🔴 REJECTED 뒤 ACCEPTED 는 받지 않는다 — 결정은 되돌려 쓰지 않는다', async () => {
      const p = await service.create(baseInput);
      await service.markPresented(p.id, ACTOR);
      await service.decide(p.id, { decision: 'REJECTED', actorId: ACTOR, reason: '환자 상태와 다름' });
      await expect(service.decide(p.id, { decision: 'ACCEPTED', actorId: ACTOR })).rejects.toBeInstanceOf(ConflictException);
      const row = prisma.__proposals[0];
      expect(row.status).toBe('REJECTED');
      expect(row.rejectReason).toBe('환자 상태와 다름');
    });

    it('EDITED 는 편집거리를 재고 **최종본은 저장하지 않는다**', async () => {
      const p = await service.create(baseInput);
      await service.markPresented(p.id, ACTOR);
      const finalText = '주호소: 두통. 계획: 경과 관찰 및 진통제.';
      const r = await service.decide(p.id, { decision: 'EDITED', actorId: ACTOR, finalText });
      expect(r.editDistance).toBeGreaterThan(0);
      expect(r.editDistanceCapped).toBe(false);
      // 최종본이 어디에도 저장되지 않았다 — 정본은 도메인 정본 테이블에 있다
      const stored = JSON.stringify(prisma.__proposals) + JSON.stringify(prisma.__transitions);
      expect(stored).not.toContain('진통제');
      expect(prisma.__transitions.at(-1)).toMatchObject({ toStatus: 'EDITED', editDistance: r.editDistance });
    });

    it('🔴 최종본이 없으면 편집거리는 null 이다 — 0 이 아니다(안 고침 ≠ 안 잼)', async () => {
      const p = await service.create(baseInput);
      await service.markPresented(p.id, ACTOR);
      const r = await service.decide(p.id, { decision: 'ACCEPTED', actorId: ACTOR });
      expect(r.editDistance).toBeNull();
      expect(r.note).toMatch(/0 이 아닙니다/);
    });

    it('같은 본문을 그대로 승인하면 편집거리 0 — null 과 구분된다', async () => {
      const p = await service.create(baseInput);
      await service.markPresented(p.id, ACTOR);
      const r = await service.decide(p.id, { decision: 'ACCEPTED', actorId: ACTOR, finalText: baseInput.content });
      expect(r.editDistance).toBe(0);
    });

    it('🔴 노출 기록 없이 결정하는 것을 막지 않되 원장에 NOT_PRESENTED 를 남긴다', async () => {
      const p = await service.create(baseInput);
      const r = await service.decide(p.id, { decision: 'ACCEPTED', actorId: ACTOR, finalText: baseInput.content });
      expect(r.notPresented).toBe(true);
      expect(prisma.__transitions.at(-1).reason).toContain('NOT_PRESENTED');
      expect(prisma.__proposals[0].status).toBe('ACCEPTED');
    });

    it('사람 사유는 NOT_PRESENTED 와 함께 남는다(둘 다 사실이다)', async () => {
      const p = await service.create(baseInput);
      await service.decide(p.id, { decision: 'REJECTED', actorId: ACTOR, reason: '근거 부족' });
      expect(prisma.__transitions.at(-1).reason).toBe('NOT_PRESENTED · 근거 부족');
    });
  });

  /* ───────── supersede ───────── */

  describe('supersede', () => {
    it('새 버전을 만들고(version+1·supersedesId) 옛 것을 SUPERSEDED 로 닫는다', async () => {
      const old = await service.create(baseInput);
      const next = await service.supersede(old.id, { ...baseInput, content: '주호소: 두통(재생성).' }, ACTOR);
      expect(next.version).toBe(old.version + 1);
      expect(next.supersedesId).toBe(old.id);
      expect(prisma.__proposals.find((p: any) => p.id === old.id).status).toBe('SUPERSEDED');
      // 🔴 옛 제안의 본문은 그대로 남는다 — 그때 AI 가 뭐라 했는지의 유일한 증거다
      expect(prisma.__proposals.find((p: any) => p.id === old.id).contentEnc).toBe(old.contentEnc);
      expect(prisma.__transitions.some((t: any) => t.proposalId === old.id && t.toStatus === 'SUPERSEDED')).toBe(true);
    });

    it('이미 대체된 제안은 다시 대체하지 않는다', async () => {
      const old = await service.create(baseInput);
      await service.supersede(old.id, { ...baseInput, content: 'v2' }, ACTOR);
      await expect(service.supersede(old.id, { ...baseInput, content: 'v3' }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  /* ───────── ⑦ 만료 ───────── */

  describe('expireDue', () => {
    it('🔴 GENERATED/PRESENTED 만 만료한다 — 만료는 거부가 아니다', async () => {
      await service.expireDue(new Date('2026-09-09T03:30:00Z'));
      const where = prisma.aiProposal.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['GENERATED', 'PRESENTED'] });
      expect(where.expiresAt).toEqual({ not: null, lte: new Date('2026-09-09T03:30:00Z') });
    });

    it('기한이 지난 건만 EXPIRED 로 바꾸고 시스템 전이(actorId null)를 남긴다', async () => {
      const due = await service.create({ ...baseInput, expiresAt: new Date('2026-09-01T00:00:00Z') });
      const alive = await service.create({ ...baseInput, expiresAt: new Date('2026-12-01T00:00:00Z') });
      const noExpiry = await service.create(baseInput);
      const r = await service.expireDue(new Date('2026-09-09T03:30:00Z'));
      expect(r).toEqual({ scanned: 1, expired: 1 });
      const byId = (id: string) => prisma.__proposals.find((p: any) => p.id === id);
      expect(byId(due.id).status).toBe('EXPIRED');
      expect(byId(alive.id).status).toBe('GENERATED');
      expect(byId(noExpiry.id).status).toBe('GENERATED');
      const tr = prisma.__transitions.find((t: any) => t.toStatus === 'EXPIRED');
      expect(tr).toMatchObject({ actorId: null, reason: 'EXPIRED_DUE' });
    });

    it('결정된 제안은 기한이 지나도 건드리지 않는다', async () => {
      const p = await service.create({ ...baseInput, expiresAt: new Date('2026-09-01T00:00:00Z') });
      await service.decide(p.id, { decision: 'REJECTED', actorId: ACTOR });
      const r = await service.expireDue(new Date('2026-09-09T03:30:00Z'));
      expect(r).toEqual({ scanned: 0, expired: 0 });
      expect(prisma.__proposals[0].status).toBe('REJECTED');
    });
  });

  /* ───────── 조회 ───────── */

  describe('get / listByPatient / inputChangeState', () => {
    it('get 은 본문을 복호하고 해시 대조 결과를 함께 낸다', async () => {
      const p = await service.create(baseInput);
      const d = await service.get(p.id);
      expect(d.content).toBe(baseInput.content);
      expect(d.contentIntegrity).toBe('OK');
      expect((d as any).contentEnc, '암호문은 응답에 담지 않는다').toBeUndefined();
      expect((d as any).transitions).toHaveLength(1);
    });

    it('🔴 본문을 읽을 수 없으면 null + 사유다 — 암호문을 본문인 척 내보내지 않는다', async () => {
      const p = await service.create(baseInput);
      // 키 회전·손상 시 `decryptField` 는 원본(암호문)을 그대로 돌려준다 — 그것을 본문으로 쓰지 않는다
      prisma.__proposals[0].contentEnc = `${'a'.repeat(32)}:${'b'.repeat(32)}:${'c'.repeat(16)}`;
      const d = await service.get(p.id);
      expect(d.content).toBeNull();
      expect(d.contentUnavailableReason).toBe('DECRYPT_FAILED');
      expect(d.contentIntegrity).toBe('UNVERIFIABLE'); // 위반이 아니라 미판정이다
    });

    it('본문이 애초에 없는 것과 못 읽는 것을 구분한다', async () => {
      const p = await service.create({ ...baseInput, content: '' });
      const d = await service.get(p.id);
      expect(d.content).toBeNull();
      expect(d.contentUnavailableReason).toBe('NOT_STORED');
    });

    it('목록은 본문을 담지 않고, 잘랐으면 잘랐다고 말한다', async () => {
      for (let i = 0; i < 3; i++) await service.create(baseInput);
      const r = await service.listByPatient(PATIENT, { limit: 2 });
      expect(r.items).toHaveLength(2);
      expect(r.truncated).toBe(true);
      expect(JSON.stringify(r.items)).not.toContain(':'.repeat(0) + '두통');
      const sel = prisma.aiProposal.findMany.mock.calls.at(-1)[0].select;
      expect(sel.contentEnc, '목록 select 에 본문이 없다').toBeUndefined();
    });

    /* ── findByTarget — 정본 대상별 조회(2026-09-09) ──
     * 🔴 왜 필요한가: 도메인 서비스가 각자 `prisma.aiProposal.findFirst` 로 대상을 찾으면
     *    같은 사실(정본↔제안 연결)에 정본이 여럿이 된다. 조회 조건이 한 곳만 갈라져도
     *    어떤 화면은 제안을 보고 어떤 화면은 못 본다.
     */
    it('대상(targetType·targetId)으로 찾고 본문은 담지 않는다', async () => {
      const p = await service.create(baseInput);
      const r = await service.findByTarget('Encounter', TARGET);
      expect(r.items.map((i: any) => i.id)).toContain(p.id);
      const call = prisma.aiProposal.findMany.mock.calls.at(-1)[0];
      expect(call.where).toMatchObject({ targetType: 'Encounter', targetId: TARGET });
      expect(call.select.contentEnc, '목록 select 에 본문이 없다').toBeUndefined();
      expect(JSON.stringify(r.items)).not.toContain('두통');
    });

    it('최신순이다 — 최신 제안을 items[0] 로 쓸 수 있다', async () => {
      await service.create(baseInput);
      await service.create(baseInput);
      const call0 = prisma.aiProposal.findMany.mock.calls;
      await service.findByTarget('Encounter', TARGET);
      const call = prisma.aiProposal.findMany.mock.calls.at(-1)[0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call0.length).toBeGreaterThan(0);
    });

    it('상태로 좁힌다 — 하나든 여럿이든 같은 모양(in)으로', async () => {
      await service.findByTarget('Encounter', TARGET, { status: 'PRESENTED' });
      expect(prisma.aiProposal.findMany.mock.calls.at(-1)[0].where.status).toEqual({ in: ['PRESENTED'] });

      await service.findByTarget('Encounter', TARGET, { status: ['GENERATED', 'PRESENTED'] });
      expect(prisma.aiProposal.findMany.mock.calls.at(-1)[0].where.status).toEqual({ in: ['GENERATED', 'PRESENTED'] });
    });

    it('🔴 상태를 주지 않으면 전 상태다 — 조건을 몰래 끼워 넣지 않는다', async () => {
      await service.findByTarget('Encounter', TARGET);
      expect(prisma.aiProposal.findMany.mock.calls.at(-1)[0].where.status).toBeUndefined();
    });

    it('미결 제안만 골라낸다(종결된 것은 걸리지 않는다)', async () => {
      const open = await service.create(baseInput);
      const closed = await service.create(baseInput);
      await service.decide(closed.id, { decision: 'REJECTED', actorId: ACTOR });
      const r = await service.findByTarget('Encounter', TARGET, { status: ['GENERATED', 'PRESENTED'] });
      const ids = r.items.map((i: any) => i.id);
      expect(ids).toContain(open.id);
      expect(ids, '이미 결정된 제안은 미결이 아니다').not.toContain(closed.id);
    });

    it('잘랐으면 잘랐다고 말한다(대상에 제안이 여럿일 수 있다)', async () => {
      for (let i = 0; i < 3; i++) await service.create(baseInput);
      const r = await service.findByTarget('Encounter', TARGET, { limit: 2 });
      expect(r.items).toHaveLength(2);
      expect(r.truncated).toBe(true);
      expect(r.limit).toBe(2);
      // 대조군: 다 담기면 잘랐다고 말하지 않는다
      expect((await service.findByTarget('Encounter', TARGET, { limit: 50 })).truncated).toBe(false);
    });

    it('다른 대상의 제안은 섞이지 않는다', async () => {
      await service.create(baseInput);
      const r = await service.findByTarget('MdtCase', TARGET);
      expect(r.items).toHaveLength(0);
      const r2 = await service.findByTarget('Encounter', ACTOR);
      expect(r2.items).toHaveLength(0);
    });

    it('🔴 입력 변경 여부는 3상태다 — 모르는 것을 "그대로였다"로 접지 않는다', async () => {
      const withHash = await service.create({ ...baseInput, inputSnapshotHash: sha256('input-v1') });
      expect(await service.inputChangeState(withHash.id, sha256('input-v1'))).toEqual({ state: 'UNCHANGED' });
      expect((await service.inputChangeState(withHash.id, sha256('input-v2'))).state).toBe('CHANGED');
      expect((await service.inputChangeState(withHash.id, null)).state).toBe('UNKNOWN');

      const noHash = await service.create(baseInput);
      const unknown = await service.inputChangeState(noHash.id, sha256('x'));
      expect(unknown.state).toBe('UNKNOWN');
      expect(unknown.reason).toMatch(/스냅샷 해시가 없습니다/);
      // boolean 래퍼는 UNKNOWN 을 안전측(true=사람이 한 번 더 본다)으로 접는다
      expect(await service.inputChanged(noHash.id, sha256('x'))).toBe(true);
      expect(await service.inputChanged(withHash.id, sha256('input-v1'))).toBe(false);
    });
  });

  /* ───────── ⑧ 본문 update 경로 부재(정적) ───────── */

  it('🔴 서비스 소스에 본문(contentEnc/contentHash)을 update 하는 경로가 없다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'modules', 'ai-proposal', 'ai-proposal.service.ts'),
      'utf8',
    );
    // 대조군: 상태 전이용 update 는 **있어야** 한다(없으면 이 검사는 아무것도 보증하지 않는다)
    const updates = src.match(/aiProposal\.updateMany\(/g) ?? [];
    expect(updates.length, '상태 전이 update 가 실제로 존재한다').toBeGreaterThanOrEqual(3);
    // 본문 필드를 data 에 싣는 update 는 0
    for (const m of src.matchAll(/aiProposal\.update(?:Many)?\(([\s\S]{0,400})/g)) {
      expect(m[1], '본문 필드를 update 하지 않는다').not.toMatch(/data:[\s\S]{0,300}(contentEnc|contentHash)/);
    }
    expect(src).not.toMatch(/aiProposalTransition\.(update|updateMany|delete|deleteMany)\(/);
  });
});
