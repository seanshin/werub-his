/**
 * 수술 전 필수 동의서 상태 (2026-09-30).
 *
 * 🔴 결함: 수술 준비 워크스테이션이 수술·마취·수혈 동의서를 **상수 "확인 필요"** 로 그렸다(P15).
 * 봉합: `GET /api/v1/consent/surgery-status` 가 동의서 원장에서 판정 — surgeryId 연결 우선, 없으면 같은 환자·종류·최근 N일.
 * 대조군: 서명본이 있으면 SIGNED 로 말한다(실제보다 덜 안전하게 말하지 않는다) · 조회 실패는 "없음"이 되지 않는다.
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { deriveSurgeryConsentStatus, type ConsentRowForStatus } from '../../src/modules/consent/surgery-consent-status';
import { ConsentService } from '../../src/modules/consent/consent.service';
import { ConsentController } from '../../src/modules/consent/consent.controller';

const NOW = new Date('2026-09-30T00:00:00Z');
const SINCE = new Date(NOW.getTime() - 30 * 86400000);
const SURG = '33333333-3333-4333-8333-333333333333';
const OTHER_SURG = '44444444-4444-4444-8444-444444444444';

const row = (o: Partial<ConsentRowForStatus>): ConsentRowForStatus => ({
  id: o.id ?? 'c', consentType: 'SURGERY', status: 'PENDING', signedAt: null, surgeryId: null,
  createdAt: new Date('2026-09-25T00:00:00Z'), isValid: true, revokedAt: null, supersededAt: null, expiresAt: null, ...o,
});
const byType = (items: ReturnType<typeof deriveSurgeryConsentStatus>) => Object.fromEntries(items.map((i) => [i.consentType, i]));

describe('deriveSurgeryConsentStatus', () => {
  it('아무것도 없으면 세 종류 모두 NONE(matchedBy null) — 상수 "확인 필요"가 아니다', () => {
    const r = byType(deriveSurgeryConsentStatus([], { since: SINCE, now: NOW }));
    expect(Object.keys(r)).toEqual(['SURGERY', 'ANESTHESIA', 'TRANSFUSION']);
    for (const t of ['SURGERY', 'ANESTHESIA', 'TRANSFUSION']) {
      expect(r[t].state).toBe('NONE');
      expect(r[t].matchedBy).toBeNull();
    }
  });

  it('서명본(status SIGNED)은 SIGNED · 미서명은 PENDING · 없는 종류는 NONE (종류별로 갈린다)', () => {
    const r = byType(deriveSurgeryConsentStatus([
      row({ id: 's1', consentType: 'SURGERY', status: 'SIGNED', signedAt: new Date('2026-09-26T00:00:00Z') }),
      row({ id: 'a1', consentType: 'ANESTHESIA', status: 'PENDING' }),
    ], { since: SINCE, now: NOW }));
    expect(r.SURGERY).toMatchObject({ state: 'SIGNED', consentId: 's1', matchedBy: 'PATIENT_WINDOW' });
    expect(r.ANESTHESIA).toMatchObject({ state: 'PENDING', consentId: 'a1' });
    expect(r.TRANSFUSION.state).toBe('NONE');
  });

  it('surgeryId 에 연결된 동의서가 있으면 그것만 본다(SURGERY_ID) — 창 안의 다른 서명본으로 덮지 않는다', () => {
    const r = byType(deriveSurgeryConsentStatus([
      row({ id: 'linked', surgeryId: SURG, status: 'PENDING', createdAt: new Date('2026-08-01T00:00:00Z') }),
      row({ id: 'loose', status: 'SIGNED', signedAt: new Date('2026-09-26T00:00:00Z') }),
    ], { surgeryId: SURG, since: SINCE, now: NOW }));
    expect(r.SURGERY).toMatchObject({ state: 'PENDING', consentId: 'linked', matchedBy: 'SURGERY_ID' });
  });

  it('다른 수술에 연결된 동의서는 느슨한 대조에서도 빠진다', () => {
    const r = byType(deriveSurgeryConsentStatus([
      row({ id: 'other', surgeryId: OTHER_SURG, status: 'SIGNED', signedAt: new Date('2026-09-26T00:00:00Z') }),
    ], { surgeryId: SURG, since: SINCE, now: NOW }));
    expect(r.SURGERY.state).toBe('NONE');
  });

  it('철회·개정 대체·만료·무효·창 밖은 유효하지 않다', () => {
    const signed = { status: 'SIGNED', signedAt: new Date('2026-09-26T00:00:00Z') };
    const cases: Partial<ConsentRowForStatus>[] = [
      { ...signed, status: 'REVOKED', revokedAt: new Date() },
      { ...signed, supersededAt: new Date() },
      { ...signed, expiresAt: new Date('2026-09-29T00:00:00Z') },
      { ...signed, isValid: false },
      { ...signed, createdAt: new Date('2026-07-01T00:00:00Z') },
    ];
    for (const c of cases) {
      expect(byType(deriveSurgeryConsentStatus([row(c)], { since: SINCE, now: NOW })).SURGERY.state).toBe('NONE');
    }
  });

  it('대조군 — 유효 서명본과 미서명이 함께 있으면 SIGNED(덜 안전하게 말하지 않는다)', () => {
    const r = byType(deriveSurgeryConsentStatus([
      row({ id: 'p', status: 'PENDING', createdAt: new Date('2026-09-28T00:00:00Z') }),
      row({ id: 's', status: 'SIGNED', signedAt: new Date('2026-09-20T00:00:00Z'), createdAt: new Date('2026-09-20T00:00:00Z') }),
    ], { since: SINCE, now: NOW }));
    expect(r.SURGERY).toMatchObject({ state: 'SIGNED', consentId: 's' });
  });
});

describe('ConsentService.getSurgeryConsentStatus', () => {
  it('환자·세 종류로 조회하고, surgeryId 가 있으면 창 밖 연결 건도 끌어온다', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const svc = new ConsentService({ consentForm: { findMany } } as never);
    const res = await svc.getSurgeryConsentStatus({ patientId: 'p1', surgeryId: SURG });
    const where = findMany.mock.calls[0][0].where;
    expect(where.patientId).toBe('p1');
    expect(where.consentType).toEqual({ in: ['SURGERY', 'ANESTHESIA', 'TRANSFUSION'] });
    expect(where.OR).toEqual(expect.arrayContaining([{ surgeryId: SURG }]));
    expect(res.rule).toBe('SURGERY_ID_THEN_PATIENT_WINDOW');
    expect(res.windowDays).toBe(30);
  });

  it('조회 실패는 전파된다 — "없음"으로 번역하지 않는다', async () => {
    const svc = new ConsentService({ consentForm: { findMany: vi.fn().mockRejectedValue(new Error('db down')) } } as never);
    await expect(svc.getSurgeryConsentStatus({ patientId: 'p1' })).rejects.toThrow('db down');
  });
});

describe('ConsentController 경로 순서', () => {
  it("'surgery-status' 가 ':id' 보다 먼저 선언된다(뒤면 UUID 파이프에 걸려 400)", () => {
    const names = Object.getOwnPropertyNames(ConsentController.prototype);
    expect(names.indexOf('surgeryStatus')).toBeGreaterThan(-1);
    expect(names.indexOf('surgeryStatus')).toBeLessThan(names.indexOf('findById'));
  });
});
