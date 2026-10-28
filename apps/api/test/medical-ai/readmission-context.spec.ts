/**
 * 재입원 예측 맥락(2026-10-07 AI 서버 회신 — HOSPITAL score 권장 키)을 기록에서만.
 *  · 1년 내 입원은 취소 입원 제외·이번 입원 제외 · 재원일수 정본 stayDays
 *  · Hb·Na 는 이번 입원 중 최근값·보고값 그대로 · 단위가 다르면 쓰지 않음 · HbA1c 는 혈색소가 아님
 *  · 응급 경유는 연결된 응급 진료 기록이 있을 때만 · 없으면 "예정 입원"이라 말하지 않는다(키를 뺀다)
 *  · 서비스: 입원을 주면 기록값 · 재원일수를 모르면 400(1로 채우지 않는다)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { buildReadmissionContext, pickLab } from '../../src/modules/medical-ai/readmission-context';

const egress = vi.fn();
vi.mock('../../src/common/util/ai-egress-fetch', async (orig) => ({ ...(await orig<object>()), aiEgressFetch: (...a: unknown[]) => egress(...a) }));
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

const at = (s: string) => new Date(s);
function prisma(o: { er?: number; surgeries?: string[]; labs?: { testName: string; value: string; unit: string; at: string }[] } = {}) {
  return {
    admission: {
      findUnique: vi.fn().mockResolvedValue({ id: 'a1', patientId: 'p1', admitDate: at('2026-10-01T00:00:00Z'), dischargeDate: at('2026-10-07T00:00:00Z') }),
      count: vi.fn().mockResolvedValue(2),
    },
    labResultItem: { findMany: vi.fn().mockResolvedValue((o.labs ?? []).map((l) => ({ testName: l.testName, value: l.value, unit: l.unit, labResult: { createdAt: at(l.at), verifiedAt: null } }))) },
    emergencyVisit: { count: vi.fn().mockResolvedValue(o.er ?? 0) },
    surgery: { findMany: vi.fn().mockResolvedValue((o.surgeries ?? []).map((procedureName) => ({ procedureName }))) },
  };
}

describe('검사 고르기', () => {
  it('🔴 HbA1c 는 혈색소가 아니다 · 단위가 다르면 쓰지 않는다 · 최근값', () => {
    const items = [
      { testName: 'HbA1c (당화혈색소)', value: '7.1', unit: '%', at: at('2026-10-06T00:00:00Z') },
      { testName: 'Hb A1c', value: '7.3', unit: '%', at: at('2026-10-07T00:00:00Z') },
      { testName: 'Hemoglobin (혈색소)', value: '11.2', unit: 'g/dL', at: at('2026-10-02T00:00:00Z') },
      { testName: 'Hemoglobin (혈색소)', value: '10.8', unit: 'g/dL', at: at('2026-10-05T00:00:00Z') },
      { testName: 'Hemoglobin', value: '108', unit: 'g/L', at: at('2026-10-06T00:00:00Z') },
    ];
    expect(pickLab(items, /^(hemoglobin|hgb|hb)\b|^혈색소/i, /^g\/dl$/i)).toMatchObject({ value: '10.8', unit: 'g/dL' });
  });
});

describe('buildReadmissionContext', () => {
  it('🔴 기록에서만 — 1년 내 입원(취소·이번 제외)·재원일수·Hb·Na·응급 경유·수술', async () => {
    const p = prisma({ er: 1, surgeries: ['관상동맥 스텐트'], labs: [{ testName: 'Hemoglobin (혈색소)', value: '10.8', unit: 'g/dL', at: '2026-10-05T00:00:00Z' }, { testName: 'Na (나트륨)', value: '132', unit: 'mEq/L', at: '2026-10-05T00:00:00Z' }] });
    const c = await buildReadmissionContext(p as never, 'a1');
    expect(c).toEqual({ patientId: 'p1', gaps: ['ONCOLOGY'], lengthOfStay: 6, pastAdmissions: 2, labResults: 'Hb 10.8 g/dL (2026-10-05), Na 132 mEq/L (2026-10-05)', admissionInfo: '응급실 경유 입원, 입원 중 수술: 관상동맥 스텐트' });
    const where = p.admission.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ patientId: 'p1', id: { not: 'a1' }, status: { not: 'CANCELLED' } });
  });
  it('🔴 기록이 없으면 null — "예정 입원"·"시술 없음"을 추정하지 않는다', async () => {
    const c = await buildReadmissionContext(prisma() as never, 'a1');
    expect(c.labResults).toBeNull();
    expect(c.admissionInfo).toBeNull();
    // 🔴 빠진 점수 항목을 말한다(AI 서버: 빠지면 0점 → 위험도 과소) — 종양내과 퇴원은 근거가 없어 늘 빠진다
    expect(c.gaps).toEqual(['HB', 'NA', 'ADMISSION_ROUTE', 'PROCEDURE', 'ONCOLOGY']);
  });
});

describe('서비스 배선', () => {
  function svc(p: unknown) {
    const s = Object.create(MedicalAiService.prototype) as any;
    s.prisma = p;
    s.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
    s.getAiConfig = async () => ({ url: 'http://ai.local', key: 'k', gpuKey: '', enabled: true, timeoutMs: 1000 });
    s.assertAiEgressUrl = () => undefined;
    s.sleep = async () => undefined;
    return s;
  }
  it('🔴 입원을 주면 기록값을 싣는다', async () => {
    egress.mockReset().mockResolvedValue(new Response(JSON.stringify({ prediction: { risk_level: 'high' }, tokens: 9 }), { status: 200 }));
    const r = await svc(prisma({ er: 1 })).predictReadmission({ age: 70, sex: 'M', diagnoses: ['심부전'], admissionId: 'a1' });
    const sent = JSON.parse(egress.mock.calls[0][2].body).patient_data;
    expect(sent).toMatchObject({ length_of_stay: 6, past_admissions: 2, admission_info: '응급실 경유 입원' });
    expect(r.risk_level).toBe('HIGH');
    expect(r.inputGaps).toEqual(['HB', 'NA', 'PROCEDURE', 'ONCOLOGY']);
  });
  it('입원 없이 부르면 기록 항목 전부 + 1년 내 입원이 빠졌다고', async () => {
    egress.mockReset().mockResolvedValue(new Response(JSON.stringify({ prediction: { risk_level: 'low' }, tokens: 9 }), { status: 200 }));
    const r = await svc(prisma()).predictReadmission({ age: 70, sex: 'M', diagnoses: ['x'], lengthOfStay: 3 });
    expect(r.inputGaps).toEqual(['HB', 'NA', 'ADMISSION_ROUTE', 'PROCEDURE', 'ONCOLOGY', 'PAST_ADMISSIONS']);
  });
  it('🔴 재원일수도 입원도 없으면 400 — 1로 채우지 않는다(상류 호출 없음)', async () => {
    egress.mockReset();
    await expect(svc(prisma()).predictReadmission({ age: 70, sex: 'M', diagnoses: [] })).rejects.toThrow(BadRequestException);
    expect(egress).not.toHaveBeenCalled();
  });
});
