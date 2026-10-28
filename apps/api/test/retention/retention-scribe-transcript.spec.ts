import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RetentionService, SCRIBE_TRANSCRIPT_RETENTION_KEY, SCRIBE_TERMINAL_STATUSES } from '../../src/modules/retention/retention.service';

/**
 * 🔴 VoiceEMR §13 D6 — 진료 대화 전사 보존·파기 (2026-09-23).
 *
 * 무엇이 틀려 있었나: `scribe.transcript.retention`(일)이 `config-runtime.service.ts` 에 **선언만** 있고 읽는 코드가 0건이라
 * 전사(`voice_utterances`)·세션 `transcript` 는 영구 보존이었다. 파기는 사람 판단(법무 미결)이라 **기존 보존 엔진의 문**
 * (전역 게이트 OFF·법무 확정·REPORT_ONLY·4-eyes·보존명령 제외)을 그대로 지나는 핸들러로만 연다.
 *
 * 지키는 것(전부 재주입으로 검증 — 파일 끝 주석):
 *  ① 설정을 읽는 소비처가 ≥1 이고, 집계가 그 값으로 cutoff 를 만든다(정책 행의 retentionDays 가 아니다)
 *  ② 전역 게이트 OFF 면 **삭제 쿼리가 한 번도 나가지 않는다**(조회조차)
 *  ③ 코드 기본값(source=default)으로는 파기하지 않는다 — 기본값은 정책이 아니다
 *  ④ `legalHold=true` 세션·활성 보존명령 환자는 후보에서 빠진다(SQL WHERE + 제외 집합 둘 다)
 *  ⑤ `draftSnapshot` 은 보존된다 — 지우는 것은 transcript·발화뿐
 *  ⑥ 원음 정책 'keep' 이면 audioPath 를 건드리지 않는다
 *  ⑦ 파기 사실이 감사에 남는다(무엇을 몇 건·어느 기간)
 *  ⑧ 대조군 — 전 게이트 통과 시 실제로 지운다(성공을 실패로 말하지 않는다)
 */

type Policy = { id: string; resourceType: string; retentionDays: number; legalMinDays: number; action: string; legalConfirmed: boolean; enabled: boolean };

function setup(opts: {
  purgeEnabled?: boolean;
  periodSource?: 'db' | 'env' | 'default' | 'unset';
  periodValue?: unknown;
  audioPolicy?: string;
  held?: string[];
  targets?: Array<{ id: string; patient_id: string; audio_path: string | null }>;
  policy?: Partial<Policy>;
}) {
  const policy: Policy = { id: 'p-scribe', resourceType: 'SCRIBE_TRANSCRIPT', retentionDays: 0, legalMinDays: 0, action: 'HARD_PURGE', legalConfirmed: true, enabled: true, ...opts.policy };
  const sqls: string[] = [];
  const targets = opts.targets ?? [];
  const prisma = {
    retentionPolicy: {
      findUnique: vi.fn(async () => policy),
      findMany: vi.fn(async () => [policy]),
      update: vi.fn(async () => ({})),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.raw.join('$');
      sqls.push(text);
      if (/SELECT s\.id, s\.patient_id, s\.audio_path/.test(text)) return targets;
      return [{ retained_total: 5, eligible: 2, held_out: 1, not_terminal: 1, oldest: new Date('2026-01-01') }];
    }),
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    voiceUtterance: { deleteMany: vi.fn(async () => ({ count: 7 })) },
    scribeSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const config = {
    get: vi.fn(async (key: string) => (key === 'retention.purgeEnabled' ? (opts.purgeEnabled ?? true) : key === 'scribe.audio.retention' ? (opts.audioPolicy ?? 'transcribed') : null)),
    getWithSource: vi.fn(async (key: string) => {
      expect(key).toBe(SCRIBE_TRANSCRIPT_RETENTION_KEY);
      const source = opts.periodSource ?? 'db';
      return { value: opts.periodValue ?? 45, source, registered: true };
    }),
  };
  const approval = { consume: vi.fn(async () => undefined) };
  const legalHold = { heldPatientIds: vi.fn(async () => new Set(opts.held ?? [])) };
  const svc = new RetentionService(prisma as never, audit as never, config as never, approval as never, legalHold as never);
  return { svc, prisma, audit, config, approval, legalHold, sqls };
}

const deleteCalls = (p: ReturnType<typeof setup>['prisma']) =>
  p.$transaction.mock.calls.length + p.voiceUtterance.deleteMany.mock.calls.length + p.scribeSession.updateMany.mock.calls.length;

describe('전사 보존·파기 — SCRIBE_TRANSCRIPT 핸들러', () => {
  it('① 설정 소비처 — 집계가 scribe.transcript.retention 을 읽어 cutoff 를 만든다(정책 행 retentionDays=0 이 아니다)', async () => {
    const { svc, config } = setup({ periodValue: 45 });
    const before = Date.now();
    const r = await svc.report();
    const row = r.policies[0];
    expect(config.getWithSource).toHaveBeenCalledWith(SCRIBE_TRANSCRIPT_RETENTION_KEY);
    expect(row.retentionDays).toBe(45);
    expect(row.retentionDaysSource).toBe(SCRIBE_TRANSCRIPT_RETENTION_KEY);
    expect(row.periodConfigured).toBe(true);
    const cutoffMs = new Date(row.cutoff as string).getTime();
    expect(Math.abs(before - 45 * 86_400_000 - cutoffMs)).toBeLessThan(5_000);
    expect(row.candidates).toBe(2);
    expect(row.detail).toEqual({ retainedTotal: 5, heldOut: 1, notTerminal: 1 });
    expect(row.candidatesByLastEncounterAt, '기산점은 세션 종료 — 마지막 진료일 기준은 성립하지 않는다').toBeNull();
  });

  it('①-b 소스 가드 — DEFAULTS 선언 파일 밖에서 이 키를 읽는 파일이 ≥1(2026-09-22 실측 0 이었다)', () => {
    const src = path.join(__dirname, '..', '..', 'src');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') && !p.endsWith('config-runtime.service.ts')
          && fs.readFileSync(p, 'utf8').includes("'scribe.transcript.retention'")) hits.push(path.relative(src, p));
      }
    };
    walk(src);
    expect(hits).toContain(path.join('modules', 'retention', 'retention.service.ts'));
  });

  it('①-c 값이 숫자가 아니면 후보를 산출하지 않는다(cutoff=null·candidates=null) — 지어내지 않는다', async () => {
    const { svc, prisma } = setup({ periodValue: 'ninety' });
    const r = await svc.report();
    expect(r.policies[0].cutoff).toBeNull();
    expect(r.policies[0].candidates).toBeNull();
    expect(r.policies[0].retentionDays).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('② 🔴 전역 게이트 OFF — 삭제 쿼리가 한 번도 나가지 않는다(조회·승인 소비도 없다)', async () => {
    const { svc, prisma, approval, audit } = setup({ purgeEnabled: false, targets: [{ id: 's1', patient_id: 'p1', audio_path: null }] });
    await expect(svc.purge('SCRIBE_TRANSCRIPT', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(deleteCalls(prisma)).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(approval.consume).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('②-b REPORT_ONLY 정책(시드 상태)이면 게이트가 켜져 있어도 거부 — 시드는 파기를 열지 않는다', async () => {
    const { svc, prisma } = setup({ policy: { action: 'REPORT_ONLY', legalConfirmed: false } });
    await expect(svc.purge('SCRIBE_TRANSCRIPT', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(deleteCalls(prisma)).toBe(0);
  });

  it('③ 🔴 코드 기본값(source=default)으로는 파기하지 않는다 — 기본값은 정책이 아니다', async () => {
    const { svc, prisma, approval } = setup({ periodSource: 'default', targets: [{ id: 's1', patient_id: 'p1', audio_path: null }] });
    await expect(svc.purge('SCRIBE_TRANSCRIPT', 'u1')).rejects.toThrow(/설정된 적 없다/);
    expect(deleteCalls(prisma)).toBe(0);
    expect(approval.consume, '승인을 헛되이 소비하지 않는다').not.toHaveBeenCalled();
    // 집계는 그 사실을 말한다
    const r = await svc.report();
    expect(r.policies[0].periodConfigured).toBe(false);
    expect(r.policies[0].periodSource).toBe('default');
  });

  it('④ 🔴 보존명령 — SQL 이 legal_hold=false 만 고르고, 활성 보존명령 환자는 제외 집합으로 한 번 더 빠진다', async () => {
    const { svc, prisma, sqls } = setup({
      held: ['pat-held'],
      targets: [
        { id: 's-free', patient_id: 'pat-free', audio_path: null },
        { id: 's-held', patient_id: 'pat-held', audio_path: null },
      ],
    });
    const r = await svc.purge('SCRIBE_TRANSCRIPT', 'u1');
    const select = sqls.find((q) => /SELECT s\.id, s\.patient_id, s\.audio_path/.test(q))!;
    expect(select).toMatch(/s\.legal_hold = false/);
    expect(select).toMatch(/s\.status IN \('APPLIED', 'FAILED', 'DELETED'\)/);
    expect(select, '미반영 대기는 후보가 아니다').not.toMatch(/TRANSCRIBED|DRAFTED/);
    const del = prisma.voiceUtterance.deleteMany.mock.calls[0][0] as { where: { sessionId: { in: string[] } } };
    expect(del.where.sessionId.in).toEqual(['s-free']);
    const upd = prisma.scribeSession.updateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(upd.where).toMatchObject({ id: { in: ['s-free'] }, legalHold: false });
    expect(r.purged).toBe(1);
  });

  it('④-b 집계 SQL 도 같은 규칙 — 세션 legal_hold 와 활성 legal_holds(해제 기록 없음) 둘 다 제외', async () => {
    const { svc, sqls } = setup({});
    await svc.report();
    const count = sqls.find((q) => /retained_total/.test(q))!;
    expect(count).toMatch(/legal_holds h/);
    expect(count).toMatch(/LEFT JOIN legal_hold_releases r ON r\.hold_id = h\.id/);
    expect(count).toMatch(/WHERE r\.id IS NULL/);
    expect(count).toMatch(/e\.legal_hold = false AND held\.patient_id IS NULL/);
  });

  it('⑤ 🔴 draftSnapshot 은 보존된다 — 세션 갱신은 transcript 만 DbNull 로, 발화만 삭제', async () => {
    const { svc, prisma } = setup({ targets: [{ id: 's1', patient_id: 'p1', audio_path: null }] });
    await svc.purge('SCRIBE_TRANSCRIPT', 'u1');
    const upd = prisma.scribeSession.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(Object.keys(upd.data)).toEqual(['transcript']);
    expect(upd.data.transcript).toBe(Prisma.DbNull);
    expect('draftSnapshot' in upd.data).toBe(false);
    // 세션 행 자체를 지우는 호출은 목에 없다 — 있었다면 TypeError 로 실패했을 것이다(대조군: 위 호출이 성공했다)
    expect((prisma.scribeSession as Record<string, unknown>).deleteMany).toBeUndefined();
  });

  it('⑥ 원음 정책 keep 이면 audioPath 를 건드리지 않는다 · transcribed 면 남은 경로를 지운다(파일은 ENOENT=이미 없음)', async () => {
    const keep = setup({ audioPolicy: 'keep', targets: [{ id: 's1', patient_id: 'p1', audio_path: 'storage/scribe/none/x.webm' }] });
    const r1 = await keep.svc.purge('SCRIBE_TRANSCRIPT', 'u1');
    expect(keep.prisma.scribeSession.updateMany).toHaveBeenCalledTimes(1); // transcript 만
    expect((r1 as { detail?: Record<string, number> }).purged).toBe(1);

    const purgeAudio = setup({ audioPolicy: 'transcribed', targets: [{ id: 's1', patient_id: 'p1', audio_path: 'storage/scribe/none/x.webm' }] });
    await purgeAudio.svc.purge('SCRIBE_TRANSCRIPT', 'u1');
    const audioUpd = purgeAudio.prisma.scribeSession.updateMany.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(audioUpd.some((d) => d.audioPath === null && d.audioDeletedAt instanceof Date)).toBe(true);
    expect(purgeAudio.config.get).toHaveBeenCalledWith('scribe.audio.retention');
  });

  it('⑦ 파기 사실이 감사에 남는다 — 종류·건수·세부·cutoff·일수', async () => {
    const { svc, audit } = setup({ targets: [{ id: 's1', patient_id: 'p1', audio_path: null }, { id: 's2', patient_id: 'p2', audio_path: null }] });
    await svc.purge('SCRIBE_TRANSCRIPT', 'u1');
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0] as { resourceType: string; changes: Record<string, { new: unknown }> };
    expect(entry.resourceType).toBe('RETENTION_PURGE');
    expect(entry.changes.resourceType.new).toBe('SCRIBE_TRANSCRIPT');
    expect(entry.changes.purged.new).toBe(2);
    expect(entry.changes.retentionDays.new).toBe(45);
    expect(typeof entry.changes.cutoff.new).toBe('string');
    expect(entry.changes.detail.new).toMatchObject({ sessions: 2, utterances: 7, heldOut: 0 });
  });

  it('⑧ 대조군 — 후보가 없으면 0건 파기·트랜잭션 없음(성공 경로가 실패로 읽히지 않는다)', async () => {
    const { svc, prisma, audit } = setup({ targets: [] });
    const r = await svc.purge('SCRIBE_TRANSCRIPT', 'u1');
    expect(r.purged).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('구조 — 핸들러가 환자 귀속·보존명령 제외를 선언하고, 종료 상태 정본이 SQL 과 같다', () => {
    const svc = new RetentionService({} as never, {} as never, {} as never, {} as never, {} as never);
    const h = (svc as unknown as { handlers: () => Record<string, { patientScoped?: boolean; honorsLegalHold?: boolean; period?: unknown; purge?: unknown }> }).handlers().SCRIBE_TRANSCRIPT;
    expect(h).toMatchObject({ patientScoped: true, honorsLegalHold: true });
    expect(typeof h.period).toBe('function');
    expect(typeof h.purge).toBe('function');
    expect([...SCRIBE_TERMINAL_STATUSES]).toEqual(['APPLIED', 'FAILED', 'DELETED']);
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'retention', 'retention.service.ts'), 'utf8');
    expect(src, '법령·기본값 수치를 핸들러에 박지 않는다').not.toMatch(/SCRIBE_TRANSCRIPT[\s\S]{0,400}retentionDays:\s*\d/);
  });
});

/*
 * 재주입 기록(2026-09-23) — 각 결함을 넣어 해당 항목이 실패하는지 확인한 뒤 원복:
 *  ② purge() 의 `if (!globalEnabled) throw` 제거 → ② 실패(deleteMany 호출됨)
 *  ③ `configured: r.source === 'db' || r.source === 'env'` 를 `configured: true` 로 → ③ 실패
 *  ④ 대상 SELECT 의 `AND s.legal_hold = false` 제거 → ④ 실패 · `rows.filter(!held.has)` 제거 → ④ 실패(s-held 삭제됨)
 *  ⑤ updateMany data 에 `draftSnapshot: Prisma.DbNull` 추가 → ⑤ 실패
 *  ① period() 가 p.retentionDays 를 돌려주게 → ① 실패(0)
 */
