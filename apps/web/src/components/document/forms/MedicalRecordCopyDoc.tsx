import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';
import { CHRONIC_OBSERVATION_LABEL, diagnosisCertaintySuffix } from '@hospital-run/shared';

type Section = { recordType: string; records: unknown };
export interface MedicalRecordCopyData {
  patient?: { name?: string; mrn?: string; dateOfBirth?: string };
  purpose?: string;
  period?: { from?: string; to?: string };
  sections?: Section[];
}

const SECTION_LABEL: Record<string, string> = {
  ENCOUNTER: '진료기록', PROGRESS: '경과기록', NURSING: '간호기록', DISCHARGE: '퇴원요약', PRESCRIPTION: '처방내역', CHRONIC: '만성질환 측정 추이',
};

const d = (v?: string, f = 'yyyy-MM-dd') => (v ? safeFormat(v, f) : '');
const arr = (r: unknown): Record<string, any>[] => (Array.isArray(r) ? (r as Record<string, any>[]) : []);

/** 의무기록 사본(MEDICAL_RECORD_COPY) — 여러 기록유형을 1건으로 묶어 섹션별 렌더. 발급 시점 동결본. */
export function MedicalRecordCopyDoc({ data, meta }: { data: MedicalRecordCopyData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const sections = data.sections ?? [];

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title="의무기록 사본" />

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ width: '16%', background: '#f3f4f6', textAlign: 'left' }}>환자</th>
            <td style={{ width: '38%' }}>{data.patient?.name ?? '-'} {data.patient?.mrn ? `(${data.patient.mrn})` : ''}</td>
            <th style={{ width: '16%', background: '#f3f4f6', textAlign: 'left' }}>생년월일</th>
            <td>{d(data.patient?.dateOfBirth) || '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>발급목적</th>
            <td>{data.purpose ?? '-'}</td>
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>대상기간</th>
            <td>{[d(data.period?.from), d(data.period?.to)].filter(Boolean).join(' ~ ') || '전체'}</td>
          </tr>
        </tbody>
      </table>

      {sections.map((sec, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, borderBottom: '2px solid #111', padding: '4px 0', marginBottom: 6 }}>
            {SECTION_LABEL[sec.recordType] ?? sec.recordType}
          </h3>
          {arr(sec.records).length === 0 && <p style={{ color: '#888', fontSize: 12 }}>해당 기록 없음</p>}

          {sec.recordType === 'ENCOUNTER' && arr(sec.records).map((r, j) => (
            <table key={j} style={{ marginBottom: 8 }}><tbody>
              <tr className="doc-row"><th style={{ width: '16%', background: '#f9fafb', textAlign: 'left' }}>진료일/의사</th>
                <td>{[d(r.date, 'yyyy-MM-dd HH:mm'), r.doctor].filter(Boolean).join(' / ')}</td></tr>
              {r.chiefComplaint && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>주호소</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.chiefComplaint}</td></tr>}
              {r.soap?.S && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>S</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.soap.S}</td></tr>}
              {r.soap?.O && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>O</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.soap.O}</td></tr>}
              {r.soap?.A && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>A</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.soap.A}</td></tr>}
              {r.soap?.P && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>P</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.soap.P}</td></tr>}
              {arr(r.diagnoses).length > 0 && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>진단</th>
                <td>{arr(r.diagnoses).map((dx) => `${dx.name ?? ''}${dx.code ? `(${dx.code})` : ''}${diagnosisCertaintySuffix(dx.certainty)}`).filter(Boolean).join(', ')}</td></tr>}
            </tbody></table>
          ))}

          {sec.recordType === 'PROGRESS' && arr(sec.records).map((r, j) => (
            <table key={j} style={{ marginBottom: 6 }}><tbody>
              <tr className="doc-row"><th style={{ width: '16%', background: '#f9fafb', textAlign: 'left' }}>{d(r.date, 'yyyy-MM-dd HH:mm')}</th>
                <td style={{ whiteSpace: 'pre-wrap' }}>{r.content}</td></tr>
            </tbody></table>
          ))}

          {sec.recordType === 'NURSING' && arr(sec.records).map((r, j) => (
            <table key={j} style={{ marginBottom: 6 }}><tbody>
              <tr className="doc-row"><th style={{ width: '16%', background: '#f9fafb', textAlign: 'left' }}>{d(r.date, 'yyyy-MM-dd HH:mm')}</th>
                <td style={{ whiteSpace: 'pre-wrap' }} data-copy-nursing-signed={r.signed === false ? 'no' : 'yes'}>{[
                  r.focus && `[${r.focus}]`, r.content,
                  r.dar?.D && `D:${r.dar.D}`, r.dar?.A && `A:${r.dar.A}`, r.dar?.R && `R:${r.dar.R}`,
                  // 🔴 (B5) 외래·응급 간호기록(SBAR)은 종전 양식이 그리지 않아 내용이 빠졌다
                  r.sbar?.S && `S:${r.sbar.S}`, r.sbar?.B && `B:${r.sbar.B}`, r.sbar?.A && `A:${r.sbar.A}`, r.sbar?.R && `R:${r.sbar.R}`,
                  r.signed === false && '(서명 체계가 없는 기록 — 외래·응급 간호기록)',
                ].filter(Boolean).join('\n')}</td></tr>
            </tbody></table>
          ))}

          {sec.recordType === 'DISCHARGE' && arr(sec.records).map((r, j) => (
            <table key={j} style={{ marginBottom: 8 }}><tbody>
              <tr className="doc-row"><th style={{ width: '16%', background: '#f9fafb', textAlign: 'left' }}>입원/퇴원</th><td>{[d(r.admitDate), d(r.dischargeDate)].filter(Boolean).join(' ~ ')}</td></tr>
              {r.admitDiagnosis && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>입원진단</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.admitDiagnosis}</td></tr>}
              <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>퇴원진단</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.dischargeDiagnosis}</td></tr>
              {r.procedures && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>시술·수술</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.procedures}</td></tr>}
              {r.conditionAtDischarge && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>퇴원 시 상태</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.conditionAtDischarge}</td></tr>}
              {r.hospitalCourse && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>경과</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.hospitalCourse}</td></tr>}
              {r.followUpPlan && <tr className="doc-row"><th style={{ background: '#f9fafb', textAlign: 'left' }}>추적계획</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.followUpPlan}</td></tr>}
            </tbody></table>
          ))}

          {/* 🔴 (B5) 발급 가능한 유형인데 그리는 분기가 없어 제목만 나가고 측정값 0줄이었다 */}
          {sec.recordType === 'CHRONIC' && arr(sec.records).length > 0 && (
            <table style={{ marginBottom: 8 }} data-copy-chronic><tbody>
              <tr className="doc-row"><th style={{ background: '#f3f4f6' }}>측정일</th><th style={{ background: '#f3f4f6' }}>항목</th><th style={{ background: '#f3f4f6' }}>값</th><th style={{ background: '#f3f4f6' }}>판정</th></tr>
              {arr(sec.records).map((r, j) => (
                <tr className="doc-row" key={j}>
                  <td>{d(r.measuredAt, 'yyyy-MM-dd HH:mm')}</td>
                  <td>{CHRONIC_OBSERVATION_LABEL[r.code] ?? r.code}</td>
                  <td>{r.value == null ? '-' : `${r.value}${r.unit ? ` ${r.unit}` : ''}`}</td>
                  <td>{r.flag ?? '-'}</td>
                </tr>
              ))}
            </tbody></table>
          )}

          {sec.recordType === 'PRESCRIPTION' && (
            <table style={{ marginBottom: 8 }}><tbody>
              <tr className="doc-row"><th style={{ background: '#f3f4f6' }}>일자</th><th style={{ background: '#f3f4f6' }}>약품/항목</th><th style={{ background: '#f3f4f6' }}>용법</th></tr>
              {arr(sec.records).map((r, j) => (
                <tr className="doc-row" key={j}>
                  <td>{d(r.date)}</td>
                  <td>{r.medication ? `${r.medication.name ?? ''}${r.medication.code ? `(${r.medication.code})` : ''}` : r.type}</td>
                  <td>{[r.dosage, r.frequency, r.duration && `${r.duration}일`, r.route].filter(Boolean).join(' ')}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      ))}

      <p style={{ fontSize: 11, color: '#666', marginTop: 8 }}>본 사본은 발급 시점의 진료기록을 동결하여 발급되었습니다(진료기록·입원 간호기록·퇴원요약은 서명 완료분 · 외래·응급 간호기록은 서명 체계가 없는 기록으로 표시). 원본과 상이할 경우 발급 의료기관에 문의하십시오.</p>
      <div style={{ marginTop: 12 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt} issuedBy={undefined} />
    </section>
  );
}
