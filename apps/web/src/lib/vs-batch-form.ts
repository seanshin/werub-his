import { scoreNews2, type News2Result } from '@hospital-run/shared';

/**
 * 간호 스테이션 'VS 일괄' 폼 → 요청 본문 · NEWS2 미리보기(2026-10-10).
 * 🔴 의식(ACVPU)·산소 투여를 **관측했을 때만** 보낸다 — 미관측을 ALERT/false 로 채우지 않는다(NEWS2 과소평가).
 * 측정 시각은 고른 경우에만(로컬 → ISO) — 비우면 서버가 "측정 시각 미상"으로 표시한다.
 */
export interface VsBatchForm {
  bodyTemperature?: string; systolicBp?: string; diastolicBp?: string; heartRate?: string;
  respiratoryRate?: string; spO2?: string; painScore?: string; note?: string;
  consciousness?: string; supplementalO2?: string; measuredAtLocal?: string;
}
const num = (v?: string) => (v != null && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const MAP: [keyof VsBatchForm, string][] = [
  ['bodyTemperature', 'temperature'], ['systolicBp', 'systolicBp'], ['diastolicBp', 'diastolicBp'],
  ['heartRate', 'heartRate'], ['respiratoryRate', 'respiratoryRate'], ['spO2', 'spo2'], ['painScore', 'painScore'],
];

export function buildVsBatchBody(form: VsBatchForm, patientId: string, admissionId?: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = { patientId, ...(admissionId ? { admissionId } : {}) };
  for (const [k, dto] of MAP) { const v = num(form[k]); if (v !== undefined) body[dto] = v; }
  if (form.consciousness) body.consciousness = form.consciousness;
  if (form.supplementalO2 === 'true' || form.supplementalO2 === 'false') body.supplementalO2 = form.supplementalO2 === 'true';
  if (form.measuredAtLocal) { const d = new Date(form.measuredAtLocal); if (!Number.isNaN(d.getTime())) body.measuredAt = d.toISOString(); }
  if (form.note && form.note.trim() !== '') body.notes = form.note.trim();
  return body;
}

/** 값이 하나라도 있는가(환자·재원·시각·메모 제외) */
export function vsBatchHasValue(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((k) => !['patientId', 'admissionId', 'measuredAt', 'notes'].includes(k));
}

/** NEWS2 미리보기 — 7요소가 다 있을 때만 점수 · 아니면 빠진 요소 목록(0점으로 그리지 않는다) */
export function vsBatchNews2Preview(form: VsBatchForm): { result: News2Result | null; missing: string[] } {
  const input = {
    respiratoryRate: num(form.respiratoryRate), spO2: num(form.spO2), systolicBp: num(form.systolicBp),
    heartRate: num(form.heartRate), temperature: num(form.bodyTemperature),
    supplementalO2: form.supplementalO2 === 'true' ? true : form.supplementalO2 === 'false' ? false : undefined,
    consciousness: form.consciousness || undefined,
  };
  const missing: string[] = [];
  if (input.respiratoryRate == null) missing.push('호흡수');
  if (input.spO2 == null) missing.push('SpO2');
  if (input.systolicBp == null) missing.push('수축기 혈압');
  if (input.heartRate == null) missing.push('심박수');
  if (input.temperature == null) missing.push('체온');
  if (input.supplementalO2 == null) missing.push('산소 투여');
  if (input.consciousness == null) missing.push('의식');
  return { result: scoreNews2(input as never), missing };
}
