import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { specialtyRecordPatients, specialtyPatientResponse, SPECIALTY_PATIENT_LIMIT } from '../../src/common/specialty-board';
import { SpecialtyExamService, familyMedCheckup } from '../../src/modules/specialty-exam/specialty-exam.service';
import { NeurosurgeryController } from '../../src/modules/neurosurgery/neurosurgery.controller';

/**
 * 전문진료 3차(2026-10-10).
 *  · 🔴 14개 전문과 `GET <과>/patients` 가 그 과 기록 표 **전체 행**을 상한 없이 읽었다(산부인과만 2,000행에서 말없이 잘림)
 *    → 환자별 최근 기록으로 묶어 상한 + 전체 수 + 잘림
 *  · 🔴 BMI — 소아 진료기록·가정의학 건강검진이 화면이 보낸 BMI 를 그대로 저장 → 체중·신장에서 서버가 계산
 */
const SRC = join(__dirname, '../../src/modules');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const g = (patientId: string, iso: string | null) => ({ patientId, _max: { examinedAt: iso ? new Date(iso) : null } });
function prisma(patients: Array<{ id: string }>) {
  return { patient: { findMany: vi.fn(async () => patients.map((p) => ({ familyName: '김', givenName: p.id, mrn: `M-${p.id}`, ...p }))) } };
}

describe('specialtyRecordPatients — 환자별 최근 기록 · 상한 · 전체 수', () => {
  it('🔴 표 전체 행이 아니라 환자별 묶음(groupBy patientId · 최근 기록 순)으로 읽는다', async () => {
    const groupBy = vi.fn(async () => [g('a', '2026-10-09'), g('b', '2026-10-01')]);
    const p = prisma([{ id: 'a' }, { id: 'b' }]);
    const r = await specialtyRecordPatients(p as never, groupBy, 'examinedAt');
    expect(groupBy).toHaveBeenCalledWith({ by: ['patientId'], _max: { examinedAt: true }, orderBy: { _max: { examinedAt: 'desc' } } });
    expect(r).toMatchObject({ total: 2, limit: SPECIALTY_PATIENT_LIMIT, truncated: false });
    expect(r.items.map((i) => i.patientId)).toEqual(['a', 'b']);
    expect(r.items[0]).toEqual({ patientId: 'a', familyName: '김', givenName: 'a', mrn: 'M-a', lastDate: new Date('2026-10-09') });
  });

  it('🔴 상한을 넘으면 잘라서 잘랐다고 말한다 — 전체 수는 잘리기 전', async () => {
    const groups = Array.from({ length: 5 }, (_, i) => g(`p${i}`, `2026-10-0${i + 1}`));
    const p = prisma(groups.slice(0, 3).map((x) => ({ id: x.patientId })));
    const r = await specialtyRecordPatients(p as never, async () => groups, 'examinedAt', 3);
    expect(r).toMatchObject({ total: 5, limit: 3, truncated: true });
    expect(r.items).toHaveLength(3);
    expect(p.patient.findMany.mock.calls[0][0].where.id.in).toEqual(['p0', 'p1', 'p2']);
  });

  it('환자 행이 없거나 시각이 없는 묶음은 지어내지 않는다 · 묶음 0 이면 환자 조회 0', async () => {
    const p = prisma([{ id: 'a' }]);
    const r = await specialtyRecordPatients(p as never, async () => [g('a', null), g('gone', '2026-10-01')], 'examinedAt');
    expect(r.items).toEqual([]);
    expect(r.total).toBe(2);
    const empty = prisma([]);
    expect(await specialtyRecordPatients(empty as never, async () => [], 'examinedAt')).toEqual({ items: [], total: 0, limit: SPECIALTY_PATIENT_LIMIT, truncated: false });
    expect(empty.patient.findMany).not.toHaveBeenCalled();
  });

  it('응답 — data 는 종전과 같은 배열(소비처 호환) · 잘림은 meta', async () => {
    const svc = { getPatients: vi.fn(async () => ({ items: [{ patientId: 'a' }], total: 7, limit: 1, truncated: true })) };
    const r = await new NeurosurgeryController(svc as never).getPatients();
    expect(r).toEqual({ data: [{ patientId: 'a' }], meta: { total: 7, limit: 1, truncated: true } });
    expect(specialtyPatientResponse({ items: [], total: 0, limit: 100, truncated: false }).meta.truncated).toBe(false);
  });
});

describe('구조 가드 — 전문과 환자 목록은 정본을 지난다', () => {
  const SERVICES: Record<string, string> = {
    'ent/ent.service.ts': 'entExam', 'neurosurgery/neurosurgery.service.ts': 'neuroExam', 'orthopedics/orthopedics.service.ts': 'orthoExam',
    'obgyn/obgyn.service.ts': 'obGynExam', 'ophthalmology/ophthalmology.service.ts': 'eyeExam', 'pediatrics/pediatrics.service.ts': 'pediatricGrowth',
    'urology/urology.service.ts': 'urologyExam', 'plastic/plastic.service.ts': 'plasticExam', 'dental/dental.service.ts': 'dentalChart',
    'dermatology/dermatology.service.ts': 'skinLesion', 'psychiatry/psychiatry.service.ts': 'psychExam',
    'internal-medicine/internal-medicine.service.ts': 'internalMedicineExam', 'burn-assessment/burn-assessment.service.ts': 'burnAssessment',
  };
  const body = (src: string) => {
    const a = src.indexOf('async getPatients()');
    let d = 0;
    for (let i = src.indexOf('{', a); i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}' && --d === 0) return src.slice(a, i + 1);
    }
    return '';
  };
  it.each(Object.entries(SERVICES))('🔴 %s — 기록 표 전체 findMany 로 환자를 접지 않는다', (file, model) => {
    const b = body(read(file));
    expect(b).toContain('specialtyRecordPatients(');
    expect(b).toContain(`this.prisma.${model}.groupBy(`);
    expect(b).not.toMatch(new RegExp(`this\\.prisma\\.${model}\\.findMany\\(\\{\\s*select`));
    expect(b).not.toContain('take: 2000');
  });
  it.each(Object.keys(SERVICES).map((f) => f.replace('.service.ts', '.controller.ts')))('%s — 잘림을 meta 로 돌려준다', (file) => {
    expect(read(file)).toContain('specialtyPatientResponse(await this.service.getPatients())');
  });
});

describe('🔴 BMI — 서버가 체중·신장에서 계산한다(화면 값 무시)', () => {
  it('소아 진료기록 — 보낸 BMI(지어낸 99)를 버리고 계산 · 신장 없으면 null', async () => {
    const create = vi.fn(async (a: any) => a.data);
    const svc = new SpecialtyExamService({ pediatricExam: { create } } as never);
    await svc.createPediatric({ patientId: 'p', weight: 20, height: 110, bmi: 99 } as never, 'u');
    expect(create.mock.calls[0][0].data.bmi).toBe(16.5);
    await svc.createPediatric({ patientId: 'p', weight: 20, bmi: 99 } as never, 'u');
    expect(create.mock.calls[1][0].data.bmi).toBeNull();
  });
  it('가정의학 건강검진 묶음 — 화면 문자열 BMI 를 덮어 계산 · 빈 칸이면 null · 나머지 칸 보존', () => {
    expect(familyMedCheckup({ height: '170', weight: '65', bmi: '99.9', grade: 'A' })).toEqual({ height: '170', weight: '65', bmi: 22.5, grade: 'A' });
    expect(familyMedCheckup({ height: '', weight: '65', bmi: '22.5' })).toMatchObject({ bmi: null });
    expect(familyMedCheckup(undefined)).toBeUndefined();
  });
  it('저장 경로가 그 함수를 지난다', async () => {
    const create = vi.fn(async (a: any) => a.data);
    await new SpecialtyExamService({ familyMedExam: { create } } as never).createFamilyMed({ patientId: 'p', checkup: { height: '180', weight: '81', bmi: '1' } } as never, 'u');
    expect(create.mock.calls[0][0].data.checkup.bmi).toBe(25);
  });
});
