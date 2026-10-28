/**
 * 수술방 차트(2026-10-05) — 수술 중 기록 원장·단계 찍기·개인 배치.
 *  🔴 종전: 수술 중 활력·약물을 입력할 화면이 없었고, 마취 기록 JSON 은 통째로 덮어써 동시 기록이 사라졌다.
 *  · 덧붙이기만 · 종류별 필수 칸·기록 가능 범위 · 미래 시각 거절 · 넣은 시각은 USER_CLAIMED
 *  · 무효: 사유 필수 · 적은 사람/관리자 · 이미 무효 409 · 단계 줄은 여기서 무효 불가(정본 칸)
 *  · 단계: 정본 칸(유도·삽관·발관 = 마취 기록 · 절개·봉합 = 수술 원장) · 이미 있으면 409 · 순서 뒤집힘 400 · 행 잠금 · PHASE 줄
 *  · 배치: 저장본 없으면 기본 · 정규화(모르는 패널·중복·화면 수) · 모양 모르는 저장본은 INVALID_SAVED 로 말한다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { OrChartService } from '../../src/modules/surgery/or-chart.service';

const NOW = new Date('2026-10-05T03:00:00Z');
const SURG = {
  id: 's1', status: 'IN_PROGRESS', scheduledAt: NOW, startedAt: NOW, endedAt: null, incisionTime: null, closureTime: null,
  procedureName: '복강경 담낭절제', bodySite: null, laterality: null, anesthesiaType: 'GENERAL', anesthetistId: 'an1', surgeonId: 'sg1',
  scrubNurseId: null, assistantId: null, patientId: 'p1',
  patient: { id: 'p1', familyName: '김', givenName: '하나', mrn: 'M1', dateOfBirth: new Date('1970-01-01'), gender: 'F' }, surgeon: { familyName: '박', givenName: '외과' },
};

function mk(o: { surgery?: Record<string, unknown> | null; anes?: Record<string, unknown> | null; event?: Record<string, unknown> | null; layoutRow?: unknown; voidCount?: number; note?: unknown; pacu?: unknown; events?: unknown[]; ai?: unknown; mode?: 'DEV' | 'REHEARSAL' | 'REAL' | null } = {}) {
  const surgery = o.surgery === null ? null : { ...SURG, ...(o.surgery ?? {}) };
  const anesState: { row: any } = { row: o.anes === undefined ? null : o.anes };
  const tx: any = {
    $queryRaw: vi.fn(async () => []),
    surgery: { findUnique: vi.fn(async () => surgery), update: vi.fn(async () => ({})) },
    anesthesiaRecord: {
      findUnique: vi.fn(async () => anesState.row),
      create: vi.fn(async (a: any) => { anesState.row = { id: 'an-rec', inductionTime: null, intubationTime: null, extubationTime: null, ...a.data }; return anesState.row; }),
      update: vi.fn(async () => ({})),
    },
    intraopEvent: { create: vi.fn(async (a: any) => ({ id: 'e-new', ...a.data })) },
    surgeryOpNote: { findFirst: vi.fn(async () => o.note ?? null) },
    pacuRecord: { findFirst: vi.fn(async () => o.pacu ?? null) },
  };
  const prisma: any = {
    ...tx,
    $transaction: async (cb: any) => cb(tx),
    surgicalChecklist: { findUnique: vi.fn(async () => null) },
    user: { findMany: vi.fn(async () => []) },
    intraopEvent: {
      create: tx.intraopEvent.create,
      findMany: vi.fn(async () => o.events ?? []),
      findUnique: vi.fn(async () => o.event ?? null),
      updateMany: vi.fn(async () => ({ count: o.voidCount ?? 1 })),
    },
    orChartLayout: {
      findUnique: vi.fn(async () => o.layoutRow ?? null),
      upsert: vi.fn(async (a: any) => ({ ...a.create, updatedAt: NOW })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  // 운영 모드 — 기본 REHEARSAL(누구나 작성) · null 이면 모드 서비스 없음(정본 폴백 REAL)
  const hisMode = o.mode === null ? undefined : { effective: vi.fn(async () => o.mode ?? 'REHEARSAL') };
  return { svc: new OrChartService(prisma, (o as { ai?: unknown }).ai as never, hisMode as never), prisma, tx };
}

describe('수술 중 기록 덧붙이기', () => {
  it('🔴 종류별 검사 — 활력 기록 가능 범위 밖·약물 단위 없음·단계 직접 입력은 거절 · 저장 안 함', async () => {
    const { svc, prisma } = mk();
    await expect(svc.addEvent('s1', { kind: 'VITALS', payload: { heartRate: 400 } }, 'u', NOW)).rejects.toThrow(/heartRate.*범위/);
    await expect(svc.addEvent('s1', { kind: 'DRUG', payload: { name: 'Propofol', dose: 100 } }, 'u', NOW)).rejects.toThrow(/단위/);
    await expect(svc.addEvent('s1', { kind: 'PHASE', payload: { phase: 'INCISION' } }, 'u', NOW)).rejects.toThrow(/단계 기록 버튼/);
    expect(prisma.intraopEvent.create).not.toHaveBeenCalled();
  });

  it('🔴 시각 — 비우면 지금(RECORDED) · 넣으면 USER_CLAIMED · 미래는 거절 · 모르는 칸은 버린다', async () => {
    const { svc, prisma } = mk();
    await svc.addEvent('s1', { kind: 'VITALS', payload: { heartRate: 72, spo2: '98', junk: 1 } }, 'u', NOW);
    expect(prisma.intraopEvent.create.mock.calls[0][0].data).toMatchObject({ kind: 'VITALS', occurredAt: NOW, occurredAtSource: 'RECORDED', payload: { heartRate: 72, spo2: 98 }, recordedById: 'u' });
    expect(prisma.intraopEvent.create.mock.calls[0][0].data.payload.junk).toBeUndefined();
    await svc.addEvent('s1', { kind: 'NOTE', payload: { text: '출혈 조절' }, occurredAt: '2026-10-05T02:30:00Z' }, 'u', NOW);
    expect(prisma.intraopEvent.create.mock.calls[1][0].data.occurredAtSource).toBe('USER_CLAIMED');
    await expect(svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' }, occurredAt: '2026-10-05T03:30:00Z' }, 'u', NOW)).rejects.toThrow(/지금보다 뒤/);
  });

  it('취소된 수술에는 기록하지 않는다 · 없는 수술 404', async () => {
    await expect(mk({ surgery: { status: 'CANCELLED' } }).svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' } }, 'u', NOW)).rejects.toMatchObject({ response: { code: 'SURGERY_CANCELLED' } });
    await expect(mk({ surgery: null }).svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' } }, 'u', NOW)).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe('무효', () => {
  const ev = { id: 'e1', surgeryId: 's1', kind: 'DRUG', recordedById: 'u1' };
  it('🔴 사유 필수 · 적은 사람이 아니면 403 · 관리자는 된다 · 이미 무효면 409', async () => {
    await expect(mk({ event: ev }).svc.voidEvent('s1', 'e1', ' ', 'u1', 'NURSE')).rejects.toThrow(/사유/);
    await expect(mk({ event: ev }).svc.voidEvent('s1', 'e1', '오기', 'u2', 'NURSE')).rejects.toMatchObject({ response: { code: 'NOT_EVENT_RECORDER' } });
    const a = mk({ event: ev });
    await a.svc.voidEvent('s1', 'e1', '오기', 'admin', 'ADMIN');
    expect(a.prisma.intraopEvent.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'e1', voidedAt: null }, data: { voidedById: 'admin', voidReason: '오기' } });
    await expect(mk({ event: ev, voidCount: 0 }).svc.voidEvent('s1', 'e1', '오기', 'u1', 'NURSE')).rejects.toMatchObject({ response: { code: 'ALREADY_VOIDED' } });
  });
  it('🔴 단계 줄은 무효 불가(정본 칸에 있다) · 다른 수술의 기록은 404', async () => {
    await expect(mk({ event: { ...ev, kind: 'PHASE' } }).svc.voidEvent('s1', 'e1', 'x', 'u1', 'ADMIN')).rejects.toMatchObject({ response: { code: 'PHASE_NOT_VOIDABLE' } });
    await expect(mk({ event: { ...ev, surgeryId: 's9' } }).svc.voidEvent('s1', 'e1', 'x', 'u1', 'ADMIN')).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe('단계 찍기', () => {
  it('🔴 절개 → 수술 원장 칸 · 행 잠금 · PHASE 줄 · 이미 있으면 409(덮지 않는다)', async () => {
    const a = mk();
    await a.svc.stampPhase('s1', 'INCISION', undefined, 'u', 'DOCTOR', NOW);
    expect(String(a.tx.$queryRaw.mock.calls[0][0].join('?'))).toMatch(/FOR UPDATE/);
    expect(a.tx.surgery.update.mock.calls[0][0].data).toEqual({ incisionTime: NOW });
    expect(a.tx.intraopEvent.create.mock.calls[0][0].data).toMatchObject({ kind: 'PHASE', payload: { phase: 'INCISION' }, occurredAtSource: 'RECORDED' });
    const b = mk({ surgery: { incisionTime: new Date('2026-10-05T02:00:00Z') } });
    await expect(b.svc.stampPhase('s1', 'INCISION', undefined, 'u', 'DOCTOR', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ALREADY_RECORDED' } });
    expect(b.tx.surgery.update).not.toHaveBeenCalled();
  });

  it('🔴 봉합은 절개 뒤 · 절개 전 시각이면 400', async () => {
    await expect(mk().svc.stampPhase('s1', 'CLOSURE', undefined, 'u', 'DOCTOR', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ORDER' } });
    await expect(mk({ surgery: { incisionTime: new Date('2026-10-05T02:00:00Z') } }).svc.stampPhase('s1', 'CLOSURE', '2026-10-05T01:00:00Z', 'u', 'DOCTOR', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ORDER' } });
  });

  it('🔴 유도 → 마취 기록 칸 · 기록이 없으면 수술의 마취 방법·마취과 의사로 만든다 · 둘 다 모르면 409', async () => {
    const a = mk();
    await a.svc.stampPhase('s1', 'INDUCTION', undefined, 'u', 'NURSE', NOW);
    expect(a.tx.anesthesiaRecord.create.mock.calls[0][0].data).toEqual({ surgeryId: 's1', anesthetistId: 'an1', anesthesiaType: 'GENERAL' });
    expect(a.tx.anesthesiaRecord.update.mock.calls[0][0].data).toEqual({ inductionTime: NOW });
    const b = mk({ surgery: { anesthetistId: null } });
    await expect(b.svc.stampPhase('s1', 'INDUCTION', undefined, 'u', 'NURSE', NOW)).rejects.toMatchObject({ response: { code: 'ANESTHESIA_RECORD_MISSING' } });
    expect(b.tx.anesthesiaRecord.create).not.toHaveBeenCalled();
    // 🔴 버튼을 누른 의사(집도의라도)를 마취의로 기록하지 않는다 — 지정이 없으면 의사가 눌러도 409
    const c = mk({ surgery: { anesthetistId: null } });
    await expect(c.svc.stampPhase('s1', 'INDUCTION', undefined, 'doc', 'DOCTOR', NOW)).rejects.toMatchObject({ response: { code: 'ANESTHESIA_RECORD_MISSING' } });
    expect(c.tx.anesthesiaRecord.create).not.toHaveBeenCalled();
  });

  it('🔴 마취 단계 순서 — 삽관은 유도 뒤 · 유도는 삽관 앞(기록된 앞 단계가 있을 때만)', async () => {
    const at = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();
    const a = mk({ anes: { id: 'ar', inductionTime: new Date(NOW.getTime() - 10 * 60_000), intubationTime: null, extubationTime: null } });
    await expect(a.svc.stampPhase('s1', 'INTUBATION', at(-20), 'u', 'NURSE', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ORDER' } });
    const b = mk({ anes: { id: 'ar', inductionTime: null, intubationTime: new Date(NOW.getTime() - 30 * 60_000), extubationTime: null } });
    await expect(b.svc.stampPhase('s1', 'INDUCTION', undefined, 'u', 'NURSE', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ORDER' } });
    // 대조군 — 앞 단계가 없으면 요구하지 않는다(척추 마취는 삽관이 없다)
    const c = mk({ anes: { id: 'ar', inductionTime: null, intubationTime: null, extubationTime: null } });
    await expect(c.svc.stampPhase('s1', 'EXTUBATION', undefined, 'u', 'NURSE', NOW)).resolves.toBeTruthy();
  });

  it('🔴 수술 예정보다 하루 이상 앞선 발생 시각은 오타로 거절 · 저장 안 함', async () => {
    const { svc, prisma } = mk();
    const early = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
    await expect(svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' }, occurredAt: early }, 'u', NOW)).rejects.toMatchObject({ response: { code: 'OCCURRED_BEFORE_SURGERY' } });
    expect(prisma.intraopEvent.create).not.toHaveBeenCalled();
    const ok = new Date(NOW.getTime() - 3_600_000).toISOString();
    await expect(svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' }, occurredAt: ok }, 'u', NOW)).resolves.toBeTruthy();
  });

  it('발관은 삽관 뒤 · 이미 찍힌 유도는 409', async () => {
    const anes = { id: 'r', inductionTime: new Date('2026-10-05T01:00:00Z'), intubationTime: new Date('2026-10-05T01:05:00Z'), extubationTime: null };
    await expect(mk({ anes }).svc.stampPhase('s1', 'EXTUBATION', '2026-10-05T01:00:00Z', 'u', 'DOCTOR', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ORDER' } });
    await expect(mk({ anes }).svc.stampPhase('s1', 'INDUCTION', undefined, 'u', 'DOCTOR', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ALREADY_RECORDED' } });
  });
});

describe('개인 배치', () => {
  it('저장본이 없으면 기본(source DEFAULT) · 모니터 2대면 화면 2개 · 모든 화면에 환자 요약', async () => {
    const r: any = await mk().svc.getLayout('u', 'MONITOR_2', 'ANESTHESIA');
    expect(r.source).toBe('DEFAULT');
    expect(r.layout.screens).toHaveLength(2);
    expect(r.layout.screens.every((s: any) => s.panels.includes('header'))).toBe(true);
  });

  it('🔴 저장은 정규화 — 모르는 패널·중복 제거 · 화면 수는 기기 구성에 맞춤(넘치면 버리고 모자라면 기본)', async () => {
    const a = mk();
    const r: any = await a.svc.saveLayout('u', { profile: 'MONITOR_2', role: 'SURGEON', layout: { screens: [{ panels: ['vitals', 'vitals', 'bogus', 'safety'], columns: 2 }, { panels: [] }, { panels: ['notes'] }] } });
    expect(r.layout.screens).toHaveLength(2);
    expect(r.layout.screens[0]).toEqual({ panels: ['vitals', 'safety'], columns: 2 });
    expect(r.layout.screens[1].panels.length).toBeGreaterThan(0); // 빈 화면 → 기본 화면
    expect(a.prisma.orChartLayout.upsert.mock.calls[0][0].where).toEqual({ userId_deviceProfile_orRole: { userId: 'u', deviceProfile: 'MONITOR_2', orRole: 'SURGEON' } });
  });

  it('🔴 모양 모르는 저장본은 INVALID_SAVED 로 말한다(조용히 기본으로 바꾸지 않는다) · 모르는 기기·역할은 400', async () => {
    const r: any = await mk({ layoutRow: { layout: 'x', updatedAt: NOW } }).svc.getLayout('u', 'TABLET', 'SCRUB');
    expect(r.source).toBe('INVALID_SAVED');
    await expect(mk().svc.getLayout('u', 'PHONE', 'SCRUB')).rejects.toThrow(/기기 구성/);
    await expect(mk().svc.saveLayout('u', { profile: 'TABLET', role: 'X', layout: { screens: [] } })).rejects.toThrow(/역할/);
    await expect(mk().svc.saveLayout('u', { profile: 'TABLET', role: 'SCRUB', layout: {} })).rejects.toThrow(/모양/);
  });
});

describe('순회 간호 자리(P1)', () => {
  it('간호사가 맡으면 수술팀 — 기본 역할이 CIRCULATING · 이름이 머리에 실린다', async () => {
    const { svc, prisma } = mk({ surgery: { circulatingNurseId: 'n2' } });
    prisma.user.findMany.mockResolvedValue([{ id: 'n2', familyName: '조', givenName: '간호' }]);
    const c = await svc.getChart('s1', 'n2');
    expect(c.suggestedRole).toBe('CIRCULATING');
    expect(c.surgery.circulatingNurse).toEqual({ id: 'n2', name: '조간호' });
  });

  it('🔴 TAKE 는 간호사·관리자만 · 교대면 이전 사람을 돌려준다', async () => {
    const { svc, prisma } = mk({ surgery: { circulatingNurseId: 'n1' } });
    await expect(svc.setCirculating('s1', 'TAKE', 'doc', 'DOCTOR')).rejects.toMatchObject({ response: { code: 'NURSE_ONLY' } });
    expect(prisma.surgery.update).not.toHaveBeenCalled();
    await expect(svc.setCirculating('s1', 'TAKE', 'n2', 'NURSE')).resolves.toEqual({ circulatingNurseId: 'n2', previous: 'n1' });
    expect(prisma.surgery.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { circulatingNurseId: 'n2' } });
  });

  it('🔴 RELEASE 는 맡은 본인·관리자만(남을 지우지 않는다)', async () => {
    const { svc, prisma } = mk({ surgery: { circulatingNurseId: 'n1' } });
    await expect(svc.setCirculating('s1', 'RELEASE', 'n2', 'NURSE')).rejects.toMatchObject({ response: { code: 'NOT_CIRCULATING' } });
    expect(prisma.surgery.update).not.toHaveBeenCalled();
    await expect(svc.setCirculating('s1', 'RELEASE', 'n1', 'NURSE')).resolves.toEqual({ circulatingNurseId: null, previous: 'n1' });
  });
});

describe('흐름·요약(10단계 정본 · 셈만)', () => {
  it('🔴 구조화 수술 기록에 절개가 있으면 차트도 그 시각 · 다시 찍으면 409(두 번째 값을 만들지 않는다)', async () => {
    const t = new Date('2026-10-05T02:10:00Z');
    const { svc, tx } = mk({ note: { incisionTime: t, closureTime: null } });
    const c = await svc.getChart('s1', 'u');
    expect(c.phases.INCISION).toEqual(t);
    expect(c.flow.phases.find((p) => p.key === 'INCISION')!.at).toBe(t.toISOString());
    await expect(svc.stampPhase('s1', 'INCISION', undefined, 'u', 'NURSE', NOW)).rejects.toMatchObject({ response: { code: 'PHASE_ALREADY_RECORDED' } });
    expect(tx.surgery.update).not.toHaveBeenCalled();
  });

  it('흐름에 회복실·체크리스트 단계가 실린다 · 다음 단계', async () => {
    const { svc, prisma } = mk({ pacu: { arrivalTime: new Date('2026-10-05T05:00:00Z'), dischargeTime: null } });
    prisma.surgicalChecklist.findUnique.mockResolvedValue({ signInCompletedAt: new Date('2026-10-05T01:00:00Z'), timeOutCompletedAt: null, signOutCompletedAt: null, countStatus: null });
    const c = await svc.getChart('s1', 'u');
    expect(c.flow.lastPhase).toBe('PACU_IN');
    expect(c.flow.nextPhase).toBe('PACU_OUT');
    expect(c.flow.unrecordedBefore).toContain('TIME_OUT');
  });

  it('🔴 요약은 원장에서 셈만 — 무효 제외 · 합계는 정본 반올림(0.1+0.2 잡음 없음) · 없는 종류는 null', async () => {
    const T = new Date('2026-10-05T03:00:00Z');
    const ev = (kind: string, payload: unknown, voided = false) => ({ id: Math.random().toString(), kind, occurredAt: T, occurredAtSource: 'RECORDED', payload, recordedAt: T, recordedById: 'u', voidedAt: voided ? T : null, voidedById: null, voidReason: null });
    const { svc } = mk({ events: [ev('FLUID', { name: 'NS', volumeMl: 0.1 }), ev('FLUID', { name: 'NS', volumeMl: 0.2 }), ev('FLUID', { name: 'NS', volumeMl: 999 }, true)] });
    const c = await svc.getChart('s1', 'u');
    expect(c.summary.io.fluidMl).toBe(0.3);
    expect(c.summary.io.urineMl).toBeNull();
    expect(c.summary.counts.voided).toBe(1);
  });
});

describe('수술 경과 요약 AI 초안(요청 시만)', () => {
  const T = new Date('2026-10-05T03:00:00Z');
  const ev = (kind: string, payload: unknown) => ({ id: Math.random().toString(), kind, occurredAt: T, occurredAtSource: 'RECORDED', payload, recordedAt: T, recordedById: 'u', voidedAt: null, voidedById: null, voidReason: null });
  const events = [ev('FLUID', { name: 'NS', volumeMl: 500 }), ev('NOTE', { text: '김하나 님 보호자 통화' }), ev('VITALS', { heartRate: 88 })];

  it('🔴 AI 에는 센 사실만 — 이름·등록번호·메모 본문을 보내지 않는다 · 출처 AI', async () => {
    const ai = { intraopNarrative: vi.fn(async () => '수액 500 mL 투여, 심박 88.') };
    const { svc } = mk({ events, ai });
    const r = await svc.aiNarrative('s1', 'u');
    expect(r.source).toBe('AI');
    const sent = (ai.intraopNarrative.mock.calls[0] as unknown as string[])[1];
    expect(sent).toContain('io.fluidMl=500');
    expect(sent).not.toMatch(/김하나|M1|보호자 통화/);
    expect(r.unverifiedNumbers).toEqual([]);
  });

  it('🔴 사실에 없는 숫자를 골라낸다 · 언어 섞임 표시', async () => {
    const ai = { intraopNarrative: vi.fn(async () => '실혈 300 mL, 수액 500 mL. 手術') };
    const { svc } = mk({ events, ai });
    const r = await svc.aiNarrative('s1', 'u');
    expect(r.unverifiedNumbers).toEqual(['300']);
    expect(r.languageMixed).toBe(true);
  });

  it('🔴 AI 가 빈 답 · 모듈 없음 · 기록 없음은 UNAVAILABLE(문장을 지어내지 않는다) · 기록 없으면 AI 를 부르지 않는다', async () => {
    const empty = { intraopNarrative: vi.fn(async () => '') };
    expect(await mk({ events, ai: empty }).svc.aiNarrative('s1', 'u')).toMatchObject({ source: 'UNAVAILABLE', reason: 'AI_EMPTY', text: null });
    expect(await mk({ events }).svc.aiNarrative('s1', 'u')).toMatchObject({ source: 'UNAVAILABLE', reason: 'AI_MODULE_MISSING' });
    const never = { intraopNarrative: vi.fn(async () => 'x'.repeat(20)) };
    const r = await mk({ ai: never, surgery: { startedAt: null } }).svc.aiNarrative('s1', 'u');
    expect(r).toMatchObject({ source: 'UNAVAILABLE', reason: 'NO_RECORDS' });
    expect(never.intraopNarrative).not.toHaveBeenCalled();
  });
});

describe('작성 권한 — 리허설은 누구나 · 리얼은 수술팀만(사용자 결정)', () => {
  it('🔴 리얼: 수술팀이 아니면 기록·단계 찍기 403(OR_TEAM_ONLY) · 저장 안 함', async () => {
    const { svc, prisma, tx } = mk({ mode: 'REAL' });
    await expect(svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' } }, 'stranger', NOW)).rejects.toMatchObject({ response: { code: 'OR_TEAM_ONLY' } });
    await expect(svc.stampPhase('s1', 'INCISION', undefined, 'stranger', 'DOCTOR', NOW)).rejects.toMatchObject({ response: { code: 'OR_TEAM_ONLY' } });
    expect(prisma.intraopEvent.create).not.toHaveBeenCalled();
    expect(tx.surgery.update).not.toHaveBeenCalled();
    const c = await svc.getChart('s1', 'stranger');
    expect(c.writePolicy).toEqual({ mode: 'REAL', teamOnly: true, onTeam: false, canWrite: false });
  });

  it('리얼: 수술팀(집도의·마취 기록의 마취의)은 쓴다', async () => {
    const { svc } = mk({ mode: 'REAL', anes: { id: 'ar', anesthetistId: 'mae', inductionTime: null, intubationTime: null, extubationTime: null } });
    await expect(svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' } }, 'sg1', NOW)).resolves.toBeTruthy();
    await expect(svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' } }, 'mae', NOW)).resolves.toBeTruthy();
  });

  it('🔴 리허설은 누구나 · 모드 서비스가 없으면 리얼로 읽는다(느슨하게 읽지 않는다)', async () => {
    const r = mk({ mode: 'REHEARSAL' });
    await expect(r.svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' } }, 'stranger', NOW)).resolves.toBeTruthy();
    expect((await r.svc.getChart('s1', 'stranger')).writePolicy).toMatchObject({ teamOnly: false, canWrite: true });
    const n = mk({ mode: null });
    await expect(n.svc.addEvent('s1', { kind: 'NOTE', payload: { text: 'x' } }, 'stranger', NOW)).rejects.toMatchObject({ response: { code: 'OR_TEAM_ONLY' } });
  });
});
