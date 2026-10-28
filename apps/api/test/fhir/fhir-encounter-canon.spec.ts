/**
 * 🔴 FHIR R4 Encounter 상태·분류·상태 이력 정본(2026-10-01 · 여정 P3-3).
 * 종전: 정정 진료가 한 매퍼에선 R4 값 목록에 없는 `amended`, 다른 매퍼에선 `in-progress` · 입원 진료도 늘 외래(AMB).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fhirEncounterClass, fhirEncounterStatus, fhirEncounterStatusHistory } from '../../src/common/fhir-encounter';
import { FhirFullService } from '../../src/modules/fhir-full/fhir-full.service';

const R4_STATUS = ['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown'];

describe('FHIR Encounter 정본', () => {
  it('🔴 상태는 R4 값 목록 안에서만 · 정정 진료는 종료(finished)', () => {
    for (const s of ['DRAFT', 'SIGNED', 'AMENDED', 'WHATEVER', null]) expect(R4_STATUS).toContain(fhirEncounterStatus(s));
    expect(fhirEncounterStatus('AMENDED')).toBe('finished');
    expect(fhirEncounterStatus('DRAFT')).toBe('in-progress');
    expect(fhirEncounterStatus('X')).toBe('unknown');
  });
  it('분류 — 기록된 방문 유형·입원 연결이 근거 · 대조군: 근거 없으면 종전 외래', () => {
    expect(fhirEncounterClass({ visitType: 'INPATIENT' }).code).toBe('IMP');
    expect(fhirEncounterClass({ visitType: null, admissionId: 'a' }).code).toBe('IMP');
    expect(fhirEncounterClass({ visitType: 'ER_CONSULT' }).code).toBe('EMER');
    expect(fhirEncounterClass({ visitType: 'OUTPATIENT', admissionId: 'a' }).code).toBe('AMB');
    expect(fhirEncounterClass({}).code).toBe('AMB');
  });
  it('상태 이력 — 원장 시각에서만 · 서명 전이면 끝 없는 진행 중 한 구간', () => {
    const c = new Date('2026-10-01T00:00:00Z');
    const sAt = new Date('2026-10-01T00:20:00Z');
    expect(fhirEncounterStatusHistory({ status: 'DRAFT', createdAt: c })).toEqual([{ status: 'in-progress', period: { start: c.toISOString() } }]);
    expect(fhirEncounterStatusHistory({ status: 'SIGNED', createdAt: c, signedAt: sAt })).toEqual([
      { status: 'in-progress', period: { start: c.toISOString(), end: sAt.toISOString() } },
      { status: 'finished', period: { start: sAt.toISOString() } },
    ]);
  });
  it('🔴 두 반출 경로가 같은 정본을 쓴다(P12) — 정정 진료가 진행 중으로 나가지 않는다', async () => {
    const enc = {
      id: 'e1', patientId: 'p1', doctorId: 'd1', status: 'AMENDED', visitType: 'INPATIENT', admissionId: 'a1',
      createdAt: new Date('2026-10-01T00:00:00Z'), signedAt: new Date('2026-10-01T01:00:00Z'),
      doctor: { familyName: '김', givenName: '의사' }, diagnoses: [],
    };
    const svc = new FhirFullService({ encounter: { findUnique: async () => enc } } as never);
    const r = (await svc.getEncounterAsResource('e1'))!;
    expect(r.status).toBe('finished');
    expect(r.class.code).toBe('IMP');
    expect(r.period.end).toBe(enc.signedAt.toISOString());
    const ctrl = readFileSync(join(__dirname, '../../src/modules/fhir/fhir.controller.ts'), 'utf8');
    expect(ctrl).toMatch(/status: fhirEncounterStatus\(enc\.status\)/);
    expect(ctrl).not.toMatch(/AMENDED: 'amended'/);
  });
});
