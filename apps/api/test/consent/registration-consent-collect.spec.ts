/**
 * 초진 등록 동의 수집(2026-10-02) — 태블릿·환자 휴대폰(전자동의)·종이(스캔 등록).
 *  🔴 종전: 직원 체크박스 → 서버가 동의서를 "환자 이름으로 서명됨·지금·유효"로 기록(서명한 적 없음) · 10종 중 3종만 저장
 *     · 태블릿·서명 링크·첨부 업로드는 수술·시술 동의서에만 이어져 있었다
 *  · 묶음 서명은 **환자가 고른 항목별 동의**를 원장 10종에 쓴다(증빙 = 묶음 · 방식 TABLET/MOBILE)
 *  · 항목 선택이 불완전하면 세션을 소비하지 않고 거부 · 휴대폰 링크 15분
 *  · 종이는 스캔본이 있어야 기록 · 묶음 닫기와 원장 10종은 한 트랜잭션 · 서명 뒤 원장 실패는 완료로 말하지 않는다
 *  · 접수 체크박스는 직원 입력(HIS)·서명자 없음으로만 · 동의서(ConsentForm) "서명됨"을 만들지 않는다
 * 재주입: 위 각각을 되돌리면 해당 it 이 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsentService, REGISTRATION_BUNDLE_TYPE } from '../../src/modules/consent/consent.service';
import { RegistrationConsentCollectService, storedPatientChoices, UNAPPLIED_GRACE_MS } from '../../src/modules/consent/registration-consent-collect.service';
import { RegistrationConsentService, CONSENT_TYPES } from '../../src/modules/registration-consent/registration-consent.service';

const TYPES = Object.keys(CONSENT_TYPES);
const all = (v: boolean) => Object.fromEntries(TYPES.map((t) => [t, v]));
const IMG = 'data:image/png;base64,iVBORw0KGgo=';

describe('원장 — 증빙에서 온 기록', () => {
  it('🔴 10종 모두 쓴다 — 고르지 않은 항목은 미동의 · 필수 미동의를 말한다 · 증빙·방식이 남는다', async () => {
    const upsert = vi.fn(async () => ({}));
    const tx = { registrationConsent: { upsert } };
    const $transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(tx));
    const svc = new RegistrationConsentService({ $transaction, registrationConsent: { upsert: vi.fn() } } as never);
    const r = await svc.recordFromEvidence('p1', {
      choices: { PRIVACY: true, SENSITIVE: true, MARKETING: true },
      signMethod: 'TABLET', signedBy: '홍길동', evidenceConsentFormId: 'cf-1', collectedBy: 'u1',
    });
    expect($transaction).toHaveBeenCalledTimes(1); // 🔴 10종은 한 트랜잭션
    expect(upsert).toHaveBeenCalledTimes(TYPES.length);
    const byType = Object.fromEntries((upsert.mock.calls as any[]).map((c) => [c[0].create.type, c[0].create]));
    expect(byType.PRIVACY).toMatchObject({ agreed: true, signMethod: 'TABLET', evidenceConsentFormId: 'cf-1', signedBy: '홍길동' });
    expect(byType.TREATMENT.agreed).toBe(false); // 고르지 않음 = 미동의(동의를 지어내지 않는다)
    expect(r.requiredComplete).toBe(false);
    expect(r.missingRequired).toEqual(expect.arrayContaining(['UNIQUE_ID', 'THIRD_PARTY', 'TREATMENT', 'HIE']));
  });
});

describe('원장 현황 — 직원 입력 필수 동의(2026-10-03)', () => {
  it('🔴 필수 동의 중 직원 입력(HIS)만으로 남은 수를 따로 낸다 · 대조군: 서명 증빙이면 0', async () => {
    const rows = (method: string) => TYPES.map((type) => ({ type, agreed: true, signMethod: method, signedAt: new Date(), signedBy: method === 'HIS' ? null : '홍길동', expiresAt: null, evidenceConsentFormId: method === 'HIS' ? null : 'cf-1', id: type }));
    const mk = (method: string) => new RegistrationConsentService({ registrationConsent: { findMany: vi.fn(async () => rows(method)) } } as never);
    const staff = await mk('HIS').getConsents('p1');
    expect(staff.requiredComplete).toBe(true); // 완료 판정은 그대로(게이트 없음)
    expect(staff.requiredStaffEntered).toBe(TYPES.filter((t) => (CONSENT_TYPES as Record<string, { required: boolean }>)[t].required).length);
    const signed = await mk('TABLET').getConsents('p1');
    expect(signed.requiredStaffEntered).toBe(0);
  });
});

describe('서명 세션 — 초진 동의 묶음', () => {
  let prisma: any;
  let registration: { recordFromEvidence: ReturnType<typeof vi.fn> };
  let svc: ConsentService;
  beforeEach(() => {
    prisma = {
      consentSignSession: {
        findUnique: vi.fn(async () => ({ token: 't', status: 'OPEN', consentId: 'cf-1', signMode: 'MOBILE', signerType: 'PATIENT', createdBy: 'u1', expiresAt: new Date(Date.now() + 60_000) })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async (a: any) => ({ ...a.data })),
      },
      consentForm: {
        findUnique: vi.fn(async () => ({ id: 'cf-1', type: REGISTRATION_BUNDLE_TYPE, patientId: 'p1', status: 'PENDING', content: { kind: 'REGISTRATION_BUNDLE', items: [{ type: 'PRIVACY' }] } })),
        update: vi.fn(async () => ({})),
      },
    };
    registration = { recordFromEvidence: vi.fn(async () => ({ requiredComplete: true, missingRequired: [] })) };
    svc = new ConsentService(prisma, undefined, undefined, undefined, registration as never);
    vi.spyOn(svc, 'sign').mockResolvedValue({ status: 'SIGNED' } as never);
  });

  it('🔴 환자가 고른 항목별 동의를 원장에 쓴다 — 방식 MOBILE · 증빙 = 묶음 · 수집 직원', async () => {
    const r = await svc.submitSignSession('t', { signatureImage: IMG, signedBy: '홍길동', choices: all(true) }, { ipAddress: '1.2.3.4' });
    expect(registration.recordFromEvidence).toHaveBeenCalledWith('p1', expect.objectContaining({
      choices: all(true), signMethod: 'MOBILE', evidenceConsentFormId: 'cf-1', collectedBy: 'u1', ipAddress: '1.2.3.4',
    }));
    expect(r).toMatchObject({ signed: true, registration: { requiredComplete: true } });
  });

  it('🔴 항목 선택이 불완전하면 거부 — 세션을 소비하지 않는다(다시 서명할 수 있게)', async () => {
    const partial = { ...all(true) } as Record<string, unknown>;
    delete partial.HIE;
    await expect(svc.submitSignSession('t', { signatureImage: IMG, signedBy: '홍길동', choices: partial })).rejects.toThrow(/모든 항목/);
    await expect(svc.submitSignSession('t', { signatureImage: IMG, signedBy: '홍길동' })).rejects.toThrow(/항목별 동의/);
    expect(prisma.consentSignSession.updateMany).not.toHaveBeenCalled();
    expect(registration.recordFromEvidence).not.toHaveBeenCalled();
  });

  it('원장 서비스가 없으면 묶음 서명을 받지 않는다(기록 없는 서명 완료를 만들지 않는다)', async () => {
    const bare = new ConsentService(prisma);
    await expect(bare.submitSignSession('t', { signatureImage: IMG, signedBy: '홍길동', choices: all(true) })).rejects.toThrow(/원장/);
  });

  it('🔴 서명 저장 뒤 원장 기록이 실패하면 완료라고 말하지 않는다', async () => {
    registration.recordFromEvidence.mockRejectedValueOnce(new Error('db'));
    await expect(svc.submitSignSession('t', { signatureImage: IMG, signedBy: '홍길동', choices: all(true) })).rejects.toThrow(/항목별 동의 기록에 실패/);
  });

  it('🔴 (10-03) 환자가 고른 항목을 서명과 같은 묶음 행에 남긴다 — 원장이 실패해도 선택이 사라지지 않는다 · 기존 본문 보존', async () => {
    registration.recordFromEvidence.mockRejectedValueOnce(new Error('db'));
    await expect(svc.submitSignSession('t', { signatureImage: IMG, signedBy: '홍길동', choices: all(true) }, { ipAddress: '1.2.3.4' })).rejects.toThrow(/선택은 남아 있습니다/);
    const data = prisma.consentForm.update.mock.calls[0][0].data;
    expect(data.content.items).toEqual([{ type: 'PRIVACY' }]);
    expect(data.content.patientChoices).toMatchObject({ choices: all(true), signMethod: 'MOBILE', signedBy: '홍길동', collectedBy: 'u1', ipAddress: '1.2.3.4' });
    expect(storedPatientChoices(data.content)).not.toBeNull(); // 저장한 모양을 복구 쪽 정본이 읽는다
    // 서명보다 먼저 남긴다
    expect(prisma.consentForm.update.mock.invocationCallOrder[0]).toBeLessThan((svc.sign as any).mock.invocationCallOrder[0]);
  });

  it('대조군: 수술·시술 동의서는 종전과 같다(항목 선택 없이 서명 · 원장 쓰지 않음)', async () => {
    prisma.consentForm.findUnique = vi.fn(async () => ({ id: 'cf-1', type: 'SURGERY', patientId: 'p1', status: 'PENDING' }));
    await svc.submitSignSession('t', { signatureImage: IMG, signedBy: '홍길동' });
    expect(registration.recordFromEvidence).not.toHaveBeenCalled();
    expect(prisma.consentForm.update.mock.calls[0][0].data.content).toBeUndefined(); // 묶음이 아니면 본문을 건드리지 않는다
  });

  it('휴대폰 링크는 15분 · 태블릿은 5분', async () => {
    prisma.consentSignSession.findUnique = vi.fn();
    const m = await svc.createSignSession('cf-1', 'u1', { signMode: 'MOBILE' });
    const t = await svc.createSignSession('cf-1', 'u1', { signMode: 'TABLET' });
    const mins = (d: Date) => Math.round((d.getTime() - Date.now()) / 60000);
    expect(mins(m.expiresAt)).toBe(15);
    expect(mins(t.expiresAt)).toBe(5);
  });

  it('서명 화면용 조회 — 묶음이면 항목·전문을 서버 정본에서 싣는다', async () => {
    prisma.consentForm.findUnique = vi.fn(async () => ({ id: 'cf-1', type: REGISTRATION_BUNDLE_TYPE, patientId: 'p1' }));
    const r = await svc.getSignSession('t');
    expect(r.registrationItems?.map((i) => i.type)).toEqual(TYPES);
    expect(r.registrationItems?.find((i) => i.type === 'PRIVACY')?.detail).toMatch(/개인정보보호법/);
  });
});

describe('수집 — 종이(스캔 등록)', () => {
  const pending = (attachments: unknown[]) => ({ id: 'cf-1', attachments });
  const make = (prisma: any, reg: any) => {
    prisma.$transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(prisma));
    return new RegistrationConsentCollectService(prisma, {} as never, {} as never, reg);
  };

  it('🔴 스캔본이 없으면 기록하지 않는다', async () => {
    const prisma = { consentForm: { findFirst: vi.fn(async () => pending([])), updateMany: vi.fn() } };
    const reg = { recordFromEvidence: vi.fn() };
    await expect(make(prisma, reg).recordPaper('p1', { choices: all(true), signedBy: '홍길동' }, 'u1')).rejects.toThrow(/스캔본/);
    expect(prisma.consentForm.updateMany).not.toHaveBeenCalled();
    expect(reg.recordFromEvidence).not.toHaveBeenCalled();
  });

  it('스캔본이 있으면 묶음을 종이 서명으로 닫고(조건부) 원장 10종 — 방식 PAPER · 증빙 = 묶음', async () => {
    const prisma = { consentForm: { findFirst: vi.fn(async () => pending([{ url: '/uploads/consent/a.pdf' }])), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() } };
    const reg = { recordFromEvidence: vi.fn(async () => ({ recorded: 10, requiredComplete: true, missingRequired: [] })) };
    const r = await make(prisma, reg).recordPaper('p1', { choices: all(true), signedBy: '홍길동' }, 'u1');
    expect(prisma.consentForm.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'cf-1', status: 'PENDING' }, data: { status: 'SIGNED', signMode: 'PAPER' } });
    expect(reg.recordFromEvidence).toHaveBeenCalledWith('p1', expect.objectContaining({ signMethod: 'PAPER', evidenceConsentFormId: 'cf-1', collectedBy: 'u1' }), prisma);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // 🔴 닫기와 원장이 한 트랜잭션
    expect(r.recorded).toBe(10);
  });

  it('종이에 표시된 대로 모든 항목을 넣어야 한다 · 그 사이 다른 경로가 닫았으면 원장을 쓰지 않는다', async () => {
    const prisma: any = { consentForm: { findFirst: vi.fn(async () => pending([{}])), updateMany: vi.fn(async () => ({ count: 0 })) } };
    const reg = { recordFromEvidence: vi.fn() };
    await expect(make(prisma, reg).recordPaper('p1', { choices: { PRIVACY: true }, signedBy: '홍' }, 'u1')).rejects.toThrow(/모든 항목/);
    await expect(make(prisma, reg).recordPaper('p1', { choices: all(true), signedBy: '홍' }, 'u1')).rejects.toThrow(/이미 서명/);
    expect(reg.recordFromEvidence).not.toHaveBeenCalled();
  });

  it('열린 묶음은 재사용 · 없으면 만든다(REGISTRATION · 10종 항목)', async () => {
    const created: any[] = [];
    const prisma = {
      patient: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
      consentForm: { findFirst: vi.fn(async () => null), create: vi.fn(async (a: any) => { created.push(a.data); return { id: 'new', status: 'PENDING', attachments: null }; }) },
    };
    await make(prisma, {}).ensurePackage('p1', 'u1');
    expect(created[0]).toMatchObject({ type: REGISTRATION_BUNDLE_TYPE, status: 'PENDING', requestedBy: 'u1' });
    expect(created[0].content.items.map((i: any) => i.type)).toEqual(TYPES);
    prisma.consentForm.findFirst = vi.fn(async () => ({ id: 'open' })) as never;
    expect((await make(prisma, {}).ensurePackage('p1', 'u1')).id).toBe('open');
  });
});

describe('서명됐지만 원장에 없는 묶음(10-03)', () => {
  const SIGNED_AT = new Date('2026-10-03T01:00:00Z');
  const stored = { kind: 'REGISTRATION_BUNDLE', patientChoices: { choices: all(true), signMethod: 'TABLET', signedBy: '홍길동', guardianName: null, guardianRelation: null, collectedBy: 'u-desk', ipAddress: null } };
  const form = (over: Record<string, unknown> = {}) => ({ id: 'cf-1', patientId: 'p1', type: REGISTRATION_BUNDLE_TYPE, status: 'SIGNED', revokedAt: null, patientSignedAt: SIGNED_AT, content: stored, ...over });
  const make = (o: { form?: unknown; refs?: number; later?: number; newer?: number } = {}) => {
    const reg = { recordFromEvidence: vi.fn(async () => ({ recorded: 10, requiredComplete: true, missingRequired: [] })) };
    const tx: any = {
      consentForm: { findUnique: vi.fn(async () => o.form === undefined ? form() : o.form), count: vi.fn(async () => o.later ?? 0) },
      registrationConsent: { count: vi.fn(async (a: any) => (a.where.evidenceConsentFormId ? (o.refs ?? 0) : (o.newer ?? 0))) },
    };
    const prisma: any = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    return { svc: new RegistrationConsentCollectService(prisma, {} as never, {} as never, reg as never), reg, tx };
  };

  it('🔴 서명본대로 원장 기록 — 서명 시각·방식·수집 직원이 서명본의 것(지금·지금 누른 직원이 아니다) · 증빙 = 묶음 · 한 트랜잭션', async () => {
    const { svc, reg, tx } = make();
    await svc.applySigned('p1', 'cf-1');
    expect(reg.recordFromEvidence).toHaveBeenCalledWith('p1', expect.objectContaining({
      choices: all(true), signMethod: 'TABLET', signedBy: '홍길동', collectedBy: 'u-desk', evidenceConsentFormId: 'cf-1', signedAt: SIGNED_AT,
    }), tx);
  });

  it.each([
    ['이미 원장에 기록됨', { refs: 10 }, /이미 원장/],
    ['더 최근 서명 묶음', { later: 1 }, /더 최근/],
    ['서명 뒤 바뀐 기록·철회', { newer: 1 }, /서명 뒤에 바뀐/],
    ['선택이 남지 않은 옛 서명', { form: form({ content: { kind: 'REGISTRATION_BUNDLE' } }) }, /다시 받아야/],
    ['서명 전 묶음', { form: form({ status: 'PENDING' }) }, /서명이 끝난/],
    ['다른 환자의 묶음', { form: form({ patientId: 'p2' }) }, /이 환자의/],
  ])('🔴 %s → 원장을 쓰지 않는다', async (_n, o, msg) => {
    const { svc, reg } = make(o as never);
    await expect(svc.applySigned('p1', 'cf-1')).rejects.toThrow(msg as RegExp);
    expect(reg.recordFromEvidence).not.toHaveBeenCalled();
  });

  it('서명본 선택은 10종 모두 있어야 한다 — 일부만으로 원장을 만들지 않는다', () => {
    const partial = { ...all(true) } as Record<string, unknown>;
    delete partial.HIE;
    expect(storedPatientChoices({ patientChoices: { choices: partial, signedBy: '홍' } })).toBeNull();
    expect(storedPatientChoices({ patientChoices: { choices: all(false), signedBy: '' } })).toBeNull();
    expect(storedPatientChoices({ patientChoices: { choices: all(false), signedBy: '홍' } })?.choices).toEqual(all(false));
  });

  it('🔴 재수집 목록 — 서명본대로 기록 가능/다시 받기(사유) · 전체 수 · 판정은 JS 정본 하나', async () => {
    const raw = [
      { consentId: 'a', patientId: 'p1', signedAt: SIGNED_AT, signMode: 'TABLET', content: stored, newerRecords: false, familyName: '홍', givenName: '길동', mrn: 'M1' },
      { consentId: 'b', patientId: 'p2', signedAt: SIGNED_AT, signMode: 'MOBILE', content: { kind: 'REGISTRATION_BUNDLE' }, newerRecords: false, familyName: '김', givenName: '철수', mrn: 'M2' },
      { consentId: 'c', patientId: 'p3', signedAt: SIGNED_AT, signMode: 'MOBILE', content: stored, newerRecords: true, familyName: '이', givenName: '영희', mrn: 'M3' },
    ];
    const $queryRaw = vi.fn().mockResolvedValueOnce(raw).mockResolvedValueOnce([{ n: 250 }]);
    const svc = new RegistrationConsentCollectService({ $queryRaw } as never, {} as never, {} as never, {} as never);
    const r = await svc.unappliedSignatures();
    expect(r.items.map((i) => [i.consentId, i.action, i.reason])).toEqual([['a', 'APPLY', null], ['b', 'RECOLLECT', 'NO_CHOICES'], ['c', 'RECOLLECT', 'NEWER_RECORDS']]);
    expect(r.total).toBe(250); // 잘렸으면 전체 수로 말한다
    expect(JSON.stringify(r.items)).not.toMatch(/patientChoices/); // 선택 본문을 목록에 싣지 않는다
    // 질의 모양 — 원장 참조 없음 · 환자별 가장 최근 서명만 · 유예
    const sql = ($queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join('?');
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM registration_consents rc WHERE rc\.evidence_consent_form_id = cf\.id\)/);
    expect(sql).toMatch(/cf2\.patient_signed_at > cf\.patient_signed_at/);
    expect(sql).toMatch(/cf\.patient_signed_at < \?/);
    const cutoff = ($queryRaw.mock.calls[0][0] as { values: unknown[] }).values.find((v) => v instanceof Date) as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(UNAPPLIED_GRACE_MS - 50);
  });
});
