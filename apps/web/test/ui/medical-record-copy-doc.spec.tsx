/**
 * 의무기록 사본 양식(2026-10-13 결함 발굴 B5).
 *  · 🔴 만성질환 추이: 발급 가능한 유형인데 분기가 없어 측정값 0줄 · 외래·응급 간호기록(SBAR) 내용 누락 + 미서명을 "서명 완료분"이라 표기 ·
 *    진단 확실도(의증·R/O)를 버려 확진처럼 · 퇴원요약 입원진단·시술·퇴원 시 상태 미인쇄
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MedicalRecordCopyDoc } from '@/components/document/forms/MedicalRecordCopyDoc';

const mount = () => render(<MedicalRecordCopyDoc data={{
  patient: { name: '홍길동' },
  sections: [
    { recordType: 'CHRONIC', records: [{ code: 'HBA1C', value: 7.2, unit: '%', measuredAt: '2026-10-01T00:00:00Z', flag: 'H' }, { code: 'XYZ', value: 0, unit: null, measuredAt: '2026-10-02T00:00:00Z', flag: null }] },
    { recordType: 'NURSING', records: [
      { date: '2026-10-01T00:00:00Z', dar: { D: '입원 간호', A: null, R: null }, signed: true },
      { date: '2026-10-02T00:00:00Z', dar: null, sbar: { S: '응급 흉통', B: '고혈압', A: '안정', R: '관찰' }, signed: false },
    ] },
    { recordType: 'ENCOUNTER', records: [{ date: '2026-10-01T00:00:00Z', doctor: '이의사', diagnoses: [{ code: 'I20', name: '협심증', certainty: 'PROVISIONAL' }, { code: 'J00', name: '감기', certainty: 'CONFIRMED' }] }] },
    { recordType: 'DISCHARGE', records: [{ admitDate: '2026-10-01', dischargeDate: '2026-10-05', admitDiagnosis: '흉통', dischargeDiagnosis: '협심증', procedures: '관상동맥조영술', conditionAtDischarge: '호전' }] },
  ],
}} />).container;

describe('🔴 의무기록 사본 — 빠지거나 다르게 나가지 않는다', () => {
  it('만성질환 측정값이 줄로 나온다(라벨 정본 · 모르는 코드는 그대로 · 0 은 0)', () => {
    const doc = mount();
    const t = doc.querySelector('[data-copy-chronic]')!.textContent!;
    expect(t).toContain('당화혈색소');
    expect(t).toContain('7.2 %');
    expect(t).toContain('XYZ');
    expect(t).toMatch(/XYZ0/);
  });
  it('외래·응급 간호기록 SBAR 내용 + 서명 체계 없음 표기 · 대조군: 입원 간호기록은 표기 없음', () => {
    const doc = mount();
    const cells = [...doc.querySelectorAll('[data-copy-nursing-signed]')];
    const un = cells.find((c) => c.getAttribute('data-copy-nursing-signed') === 'no')!.textContent!;
    expect(un).toContain('응급 흉통');
    expect(un).toContain('서명 체계가 없는 기록');
    expect(cells.find((c) => c.getAttribute('data-copy-nursing-signed') === 'yes')!.textContent).not.toContain('서명 체계가 없는');
    expect(doc.textContent).not.toContain('간호기록·퇴원요약은 서명 완료분 기준');
  });
  it('의증은 [의증] · 확진은 꼬리표 없음 · 퇴원요약 입원진단·시술·퇴원 시 상태', () => {
    const doc = mount();
    expect(doc.textContent).toContain('협심증(I20) [의증]');
    expect(doc.textContent).toContain('감기(J00)');
    expect(doc.textContent).not.toContain('감기(J00) [');
    for (const s of ['흉통', '관상동맥조영술', '호전']) expect(doc.textContent).toContain(s);
  });
});
