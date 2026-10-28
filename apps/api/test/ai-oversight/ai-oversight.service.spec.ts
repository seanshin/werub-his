/**
 * AiOversightService — AI 감독 지표의 **정직성 계약**.
 *
 * 🔴 목은 **정본(Prisma)의 실제 반환 모양**을 쓴다: `count`→number, `groupBy`→`[{키…, _count:{_all:n}}]`,
 *    `findMany`→행 배열, `findUnique`→행|null. 내가 가정한 모양을 목에 넣으면 가드가 헛돈다
 *    (수술기록 `ebl`: 단위 테스트는 통과했는데 실파이프는 400 이었고 저장은 0건이었다).
 *
 * 🔴 이 스펙이 지키는 사실:
 *    ① 분모 0 이면 비율은 `null`+사유다 — `0%` 가 아니다
 *    ② `ACCEPTED` 를 "무수정 승인"으로 읽지 않는다(수정 있음/없음/미측정 셋)
 *    ③ 검토 소요 표본이 적으면 분포를 내지 않는다(작은 표본의 p90 은 사실이 아니다)
 *    ④ 무검토 임계가 **미설정이면 그렇게 말한다**(코드 기본값을 정책인 척하지 않는다)
 *    ⑤ 노출 없이 결정된 건을 "0초 검토"로 세지 않는다
 *    ⑥ CSV 에 PHI·초안 본문이 없다(환자는 가명, 거부 사유는 기록 여부만)
 *    ⑦ 호출 분포는 정본에 위임한다(같은 집계를 두 번 만들지 않는다)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AiOversightService, percentile, normalizeDays } from '../../src/modules/ai-oversight/ai-oversight.service';

const PATIENT_A = '11111111-1111-4111-8111-111111111111';
const PATIENT_B = '22222222-2222-4222-8222-222222222222';
const DOCTOR = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, any>;

/** Prisma 반환 모양을 흉내내는 목 — 행을 실제로 보관하고 where 를 (필요한 만큼) 해석한다 */
function makePrisma(seed: { proposals?: Row[]; transitions?: Row[]; calls?: Row[]; staff?: Row[]; configs?: Row[] } = {}) {
  const proposals = seed.proposals ?? [];
  const transitions = seed.transitions ?? [];
  const calls = seed.calls ?? [];
  const staff = seed.staff ?? [];
  const configs = seed.configs ?? [];

  const matchOne = (row: Row, key: string, cond: any): boolean => {
    if (cond === null) return row[key] == null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('not' in cond) return cond.not === null ? row[key] != null : row[key] !== cond.not;
      if ('gt' in cond) return row[key] != null && row[key] > cond.gt;
      if ('gte' in cond) return row[key] != null && row[key] >= cond.gte;
      if ('lt' in cond) return row[key] != null && row[key] < cond.lt;
      return true;
    }
    return row[key] === cond;
  };

  const match = (row: Row, where: any): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === 'AND') return (v as any[]).every((w) => match(row, w));
      return matchOne(row, k, v);
    });
  };

  const filter = (rows: Row[], where: any) => rows.filter((r) => match(r, where));

  const groupBy = (rows: Row[]) => async ({ by, where }: any) => {
    const out = new Map<string, any>();
    for (const r of filter(rows, where)) {
      const key = JSON.stringify(by.map((b: string) => r[b] ?? null));
      const cur = out.get(key) ?? { ...Object.fromEntries(by.map((b: string) => [b, r[b] ?? null])), _count: { _all: 0 } };
      cur._count._all += 1;
      out.set(key, cur);
    }
    return [...out.values()];
  };

  /**
   * 🔴 `select` 를 **실제로 적용**한다. Prisma 는 select 한 필드만 돌려주는데, 목이 행 전체를
   *    돌려주면 "select 에 없어서 안 나간다"는 사실을 스펙이 검증하지 못한다 —
   *    반대로 select 를 무시하는 목은 있지도 않은 누수를 잡아 오탐을 만든다(실제로 그랬다).
   */
  const applySelect = (row: Row, select: any) =>
    select ? Object.fromEntries(Object.entries(select).filter(([, v]) => v === true).map(([k]) => [k, row[k] ?? null])) : row;

  const findMany = (rows: Row[]) => async ({ where, take, select }: any = {}) => {
    const out = filter(rows, where).map((r) => applySelect(r, select));
    return take ? out.slice(0, take) : out;
  };

  return {
    aiProposal: {
      count: vi.fn(async ({ where }: any) => filter(proposals, where).length),
      groupBy: vi.fn(groupBy(proposals)),
      findMany: vi.fn(findMany(proposals)),
    },
    aiProposalTransition: { findMany: vi.fn(findMany(transitions)) },
    aiCallLog: { findMany: vi.fn(findMany(calls)) },
    staff: { findMany: vi.fn(findMany(staff)) },
    systemConfig: {
      findUnique: vi.fn(async ({ where }: any) => configs.find((c) => c.key === where.key) ?? null),
    },
  } as any;
}

/** 🔴 정본(`AiCallLogService.callStats`)의 **실제 반환 모양** — 소스에서 확인한 필드만 쓴다 */
function makeCallLog(sample = 0) {
  return {
    callStats: vi.fn(async (days: number) => ({
      windowDays: days,
      since: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      sample,
      rows: [],
      byStatusClass: [],
      note: 'test',
    })),
  } as any;
}

const svc = (prisma: any, callLog: any = makeCallLog()) => new AiOversightService(prisma, callLog);
const ago = (mins: number) => new Date(Date.now() - mins * 60 * 1000);
const proposal = (over: Row = {}): Row => ({
  id: `p-${Math.random().toString(16).slice(2)}`,
  kind: 'SOAP_DRAFT',
  targetType: 'Encounter',
  targetId: PATIENT_A,
  patientId: PATIENT_A,
  modelRef: 'qwen2.5:14b',
  promptVersion: 'v1',
  inputSnapshotHash: null,
  contentHash: 'abc',
  confidence: null,
  source: 'AI',
  reasonCode: null,
  status: 'GENERATED',
  version: 1,
  editDistance: null,
  rejectReason: null,
  createdAt: ago(60),
  presentedAt: null,
  decidedAt: null,
  decidedBy: null,
  ...over,
});

/* ═════════════ ① 분모 0 ═════════════ */

describe('분모 0 — 비율은 null 이고 왜인지 말한다', () => {
  it('제안이 한 건도 없으면 네 비율이 전부 null 이다(0% 가 아니다)', async () => {
    const s = svc(makePrisma({ proposals: [] }));
    const r = await s.summary({ days: 7 });

    expect(r.total).toBe(0);
    for (const key of ['accepted', 'edited', 'rejected', 'expired'] as const) {
      expect(r.rates[key].pct, `${key} 가 값을 냈다`).toBeNull();
      expect(r.rates[key].unavailableReason).toBe('ZERO_DENOMINATOR');
      // 🔴 분모 이름이 없으면 사람이 서로 다른 분모를 같은 것으로 읽는다
      expect(r.rates[key].denominatorLabel).toBeTruthy();
    }
  });

  it('🔴 대조군: 표본이 있으면 실제로 값을 낸다(전부 null 로 접힌 것이 아니다)', async () => {
    const s = svc(
      makePrisma({
        proposals: [
          proposal({ status: 'ACCEPTED' }),
          proposal({ status: 'ACCEPTED' }),
          proposal({ status: 'REJECTED' }),
          proposal({ status: 'EDITED' }),
        ],
      }),
    );
    const r = await s.summary({ days: 7 });
    expect(r.decided).toBe(4);
    expect(r.rates.accepted.pct).toBe(50);
    expect(r.rates.accepted.denominator).toBe(4);
    expect(r.rates.rejected.pct).toBe(25);
  });

  it('🔴 만료는 결정이 아니다 — 만료율의 분모가 결정 건수와 다르다', async () => {
    const s = svc(
      makePrisma({
        proposals: [proposal({ status: 'ACCEPTED' }), proposal({ status: 'EXPIRED' })],
      }),
    );
    const r = await s.summary({ days: 7 });
    expect(r.rates.accepted.denominator).toBe(1); // 결정된 건
    expect(r.rates.expired.denominator).toBe(2); // 결정 + 만료
    expect(r.rates.expired.denominatorLabel).not.toBe(r.rates.accepted.denominatorLabel);
    // 만료를 결정 분모에 얹었다면 비율 합이 100% 를 넘었을 것이다
    expect(r.rates.accepted.pct! + r.rates.expired.pct!).toBeLessThanOrEqual(150);
  });

  it('부서 필터가 아무도 못 찾으면 그 사실을 말한다 — 0 을 "제안 없음"으로 그리지 않는다', async () => {
    const s = svc(makePrisma({ proposals: [proposal({ status: 'ACCEPTED', decidedBy: DOCTOR })], staff: [] }));
    const r = await s.summary({ days: 7, dept: '없는과' });
    expect(r.total).toBe(0);
    expect(r.filters.deptMatchedUsers).toBe(0);
    expect(r.filters.deptNote).toMatch(/셀 대상이 없/);
  });

  it('부서 직원 중 계정 미연결이 있으면 셀 수 없다고 말한다', async () => {
    const s = svc(
      makePrisma({
        proposals: [proposal({ status: 'ACCEPTED', decidedBy: DOCTOR })],
        staff: [
          { userId: DOCTOR, department: '내과', familyName: '김', givenName: '의사' },
          { userId: null, department: '내과', familyName: '박', givenName: '미연결' },
        ],
      }),
    );
    const r = await s.summary({ days: 7, dept: '내과' });
    expect(r.filters.deptMatchedUsers).toBe(1);
    expect(r.filters.deptNote).toMatch(/1명은 시스템 계정/);
  });
});

/* ═════════════ ② ACCEPTED + editDistance ═════════════ */

describe('ACCEPTED 를 "무수정 승인"으로 읽지 않는다', () => {
  it('🔴 수정 있음(>0) · 없음(=0) · 미측정(null) 셋으로 가른다', async () => {
    const s = svc(
      makePrisma({
        proposals: [
          proposal({ status: 'ACCEPTED', editDistance: 42 }),
          proposal({ status: 'ACCEPTED', editDistance: 7 }),
          proposal({ status: 'ACCEPTED', editDistance: 0 }),
          proposal({ status: 'ACCEPTED', editDistance: null }),
        ],
      }),
    );
    const r = await s.summary({ days: 7 });
    expect(r.accepted.total).toBe(4);
    expect(r.accepted.withEdits).toBe(2);
    expect(r.accepted.unedited).toBe(1);
    // 🔴 "안 고쳤다"(0)와 "안 쟀다"(null)를 합치면 승인 품질이 거짓이 된다
    expect(r.accepted.editUnmeasured).toBe(1);
    expect(r.accepted.withEdits + r.accepted.unedited + r.accepted.editUnmeasured).toBe(r.accepted.total);
  });

  it('🔴 재주입 대조군: 미측정(null)을 무수정에 합치면 두 값이 어긋난다', async () => {
    const s = svc(makePrisma({ proposals: [proposal({ status: 'ACCEPTED', editDistance: null })] }));
    const r = await s.summary({ days: 7 });
    expect(r.accepted.unedited).toBe(0); // null 은 0 이 아니다
    expect(r.accepted.editUnmeasured).toBe(1);
  });
});

/* ═════════════ ③ 검토 소요시간 표본 ═════════════ */

describe('검토 소요시간 — 표본이 적으면 분포를 내지 않는다', () => {
  const decided = (sec: number) =>
    proposal({ status: 'ACCEPTED', presentedAt: new Date(Date.now() - sec * 1000 - 1000), decidedAt: new Date(Date.now() - 1000) });

  it(`표본 ${AiOversightService.MIN_DISTRIBUTION_SAMPLE - 1}건이면 p50/p90 이 null 이고 사유가 붙는다`, async () => {
    const rows = Array.from({ length: AiOversightService.MIN_DISTRIBUTION_SAMPLE - 1 }, (_, i) => decided(30 + i));
    const s = svc(makePrisma({ proposals: rows }));
    const r = await s.summary({ days: 7 });
    expect(r.review.sample).toBe(rows.length);
    expect(r.review.p50Sec).toBeNull();
    expect(r.review.p90Sec).toBeNull();
    expect(r.review.distributionUnavailableReason).toMatch(/분포를 내지 않습니다/);
  });

  it(`🔴 대조군: ${AiOversightService.MIN_DISTRIBUTION_SAMPLE}건이면 실제로 값을 낸다`, async () => {
    const rows = Array.from({ length: AiOversightService.MIN_DISTRIBUTION_SAMPLE }, (_, i) => decided(30 + i * 10));
    const s = svc(makePrisma({ proposals: rows }));
    const r = await s.summary({ days: 7 });
    expect(r.review.p50Sec).not.toBeNull();
    expect(r.review.p90Sec).not.toBeNull();
    expect(r.review.distributionUnavailableReason).toBeNull();
  });

  it('🔴 노출 기록 없이 결정된 건을 "0초 검토"로 세지 않는다', async () => {
    const s = svc(
      makePrisma({
        proposals: [
          proposal({ status: 'ACCEPTED', presentedAt: null, decidedAt: new Date() }),
          proposal({ status: 'REJECTED', presentedAt: null, decidedAt: new Date() }),
        ],
      }),
    );
    const r = await s.summary({ days: 7 });
    expect(r.review.notPresentedDecided).toBe(2);
    expect(r.review.sample).toBe(0); // 잴 수 있었던 건이 없다
    expect(r.review.quickAccept.count).toBe(0); // 0초로 세어 무검토 의심에 넣지 않는다
  });
});

/* ═════════════ ④ 무검토 임계 고지 ═════════════ */

describe('무검토 승인 임계 — 기본값을 정책인 척하지 않는다', () => {
  it('🔴 미설정이면 configured:false 와 고지 문구를 낸다', async () => {
    const s = svc(makePrisma({ configs: [] }));
    const p = await s.quickAcceptPolicy();
    expect(p.seconds).toBe(AiOversightService.QUICK_ACCEPT_DEFAULT_SEC);
    expect(p.configured).toBe(false);
    expect(p.note).toContain(AiOversightService.QUICK_ACCEPT_CONFIG_KEY);
    expect(p.note).toMatch(/미설정/);
  });

  it('설정돼 있으면 그 값을 쓰고 configured:true 로 말한다', async () => {
    const s = svc(makePrisma({ configs: [{ key: AiOversightService.QUICK_ACCEPT_CONFIG_KEY, value: 12 }] }));
    const p = await s.quickAcceptPolicy();
    expect(p.seconds).toBe(12);
    expect(p.configured).toBe(true);
  });

  it('임계 미만 ACCEPTED 만 무검토 의심에 담긴다(거부·느린 승인은 아니다)', async () => {
    const now = Date.now();
    const s = svc(
      makePrisma({
        proposals: [
          proposal({ status: 'ACCEPTED', presentedAt: new Date(now - 2000), decidedAt: new Date(now) }), // 2초
          proposal({ status: 'ACCEPTED', presentedAt: new Date(now - 60_000), decidedAt: new Date(now) }), // 60초
          proposal({ status: 'REJECTED', presentedAt: new Date(now - 1000), decidedAt: new Date(now) }), // 1초 거부
        ],
      }),
    );
    const r = await s.summary({ days: 7 });
    expect(r.review.quickAccept.thresholdSec).toBe(AiOversightService.QUICK_ACCEPT_DEFAULT_SEC);
    expect(r.review.quickAccept.count).toBe(1);
    expect(r.review.quickAccept.items[0].seconds).toBe(2);
  });
});

/* ═════════════ ⑤ 목록 ═════════════ */

describe('제안 목록 — 본문도 환자 UUID 도 나가지 않는다', () => {
  it('🔴 patientId 원값이 없고 가명만 있다', async () => {
    const s = svc(makePrisma({ proposals: [proposal({ status: 'ACCEPTED', patientId: PATIENT_A })] }));
    const r = await s.proposals({ days: 7 });
    const item = r.items[0] as Record<string, unknown>;
    expect(item).not.toHaveProperty('patientId');
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('contentEnc');
    expect(typeof item.patientPseudonym).toBe('string');
    expect(item.patientPseudonym).not.toBe(PATIENT_A);
    expect(JSON.stringify(r)).not.toContain(PATIENT_A);
  });

  it('환자가 다르면 가명도 다르다(같은 값으로 접힌 것이 아니다)', async () => {
    const s = svc(makePrisma({ proposals: [proposal({ patientId: PATIENT_A }), proposal({ patientId: PATIENT_B })] }));
    const r = await s.proposals({ days: 7 });
    const [a, b] = r.items as Record<string, unknown>[];
    expect(a.patientPseudonym).not.toBe(b.patientPseudonym);
  });

  it('잘랐으면 잘랐다고 말한다', async () => {
    const s = svc(makePrisma({ proposals: [proposal(), proposal(), proposal()] }));
    const r = await s.proposals({ days: 7, limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});

/* ═════════════ ⑥ CSV — PHI·본문 없음 ═════════════ */

describe('CSV 내보내기 — PHI 도 초안 본문도 없다', () => {
  it('🔴 환자 UUID 가 CSV 어디에도 없고 가명이 대신 있다', async () => {
    const s = svc(
      makePrisma({
        proposals: [proposal({ id: 'p1', status: 'ACCEPTED', patientId: PATIENT_A, rejectReason: null })],
        transitions: [{ id: 't1', proposalId: 'p1', fromStatus: 'GENERATED', toStatus: 'PRESENTED', actorId: DOCTOR, at: new Date(), reason: null, editDistance: null, clientContext: null }],
        calls: [{ id: 'c1', skill: 'soap-draft', client: 'encounter', requestedModel: 'q', modelRef: 'q', latencyMs: 100, httpStatus: 200, source: null, reasonCode: null, proposalId: null, bytes: 10, mode: 'REHEARSAL', createdAt: new Date() }],
      }),
    );
    const f = await s.exportCsv(null, null);
    expect(f.content).not.toContain(PATIENT_A);
    expect(f.content).toContain('patient_pseudonym');
    expect(f.counts).toEqual({ proposals: 1, transitions: 1, calls: 1 });
    // 세 구획이 모두 있다
    expect(f.content).toContain('# section,proposals');
    expect(f.content).toContain('# section,transitions');
    expect(f.content).toContain('# section,calls');
  });

  it('🔴 자유 입력 거부 사유의 **원문**을 내보내지 않는다(기록 여부만)', async () => {
    const secret = '환자가 임신 중이라 거부';
    const s = svc(makePrisma({ proposals: [proposal({ id: 'p1', status: 'REJECTED', rejectReason: secret })] }));
    const f = await s.exportCsv(null, null);
    expect(f.content).not.toContain(secret);
    expect(f.content).toContain('reject_reason_recorded');
  });

  it('🔴 select 에 본문 컬럼(contentEnc)이 없다 — 새는 경로 자체를 만들지 않는다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/modules/ai-oversight/ai-oversight.service.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/contentEnc:\s*true/);
    expect(src).not.toMatch(/\bcontent:\s*true/);
  });

  it('날짜 파싱 실패는 500 이 아니라 400 이다', async () => {
    const s = svc(makePrisma());
    await expect(s.exportCsv('어제', null)).rejects.toMatchObject({ status: 400 });
  });
});

/* ═════════════ ⑦ 호출 분포는 정본에 위임 ═════════════ */

describe('호출 분포 — 같은 집계를 두 번 만들지 않는다', () => {
  it('🔴 정본 callStats 를 실제로 부른다', async () => {
    const callLog = makeCallLog(3);
    const s = svc(makePrisma({ calls: [] }), callLog);
    const r = await s.calls(30);
    expect(callLog.callStats).toHaveBeenCalledWith(30);
    expect(r.distribution.sample).toBe(3);
  });

  it('지연 표본이 적으면 p50/p90 을 내지 않는다', async () => {
    const s = svc(makePrisma({ calls: [{ latencyMs: 100, createdAt: new Date() }] }), makeCallLog(1));
    const r = await s.calls(7);
    expect(r.latency.sample).toBe(1);
    expect(r.latency.p50Ms).toBeNull();
    expect(r.latency.unavailableReason).toMatch(/분포를 내지 않습니다/);
  });

  it('🔴 대조군: 표본이 충분하면 값을 낸다', async () => {
    const calls = Array.from({ length: 5 }, (_, i) => ({ latencyMs: (i + 1) * 100, createdAt: new Date() }));
    const s = svc(makePrisma({ calls }), makeCallLog(5));
    const r = await s.calls(7);
    expect(r.latency.p50Ms).toBe(300);
    expect(r.latency.p90Ms).toBe(460);
  });
});

/* ═════════════ 순수 함수 ═════════════ */

describe('순수 함수', () => {
  it('표본 0 의 백분위는 호출부가 먼저 판정해야 한다(조용히 0 을 내지 않는다)', () => {
    expect(() => percentile([], 50)).toThrow();
  });

  it('허용 기간은 7·30·90 뿐 — 그 밖은 7 로 접는다', () => {
    expect(normalizeDays(30)).toBe(30);
    expect(normalizeDays(90)).toBe(90);
    expect(normalizeDays(365)).toBe(7);
    expect(normalizeDays(undefined)).toBe(7);
  });
});
