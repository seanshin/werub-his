import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { SignatureBlock } from '../SignatureBlock';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { documentTitle } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

export interface EncounterRecordData {
  patient: { name?: string; mrn?: string; sex?: string; birth?: string };
  visitType?: string;
  date?: string;
  cc?: string; hpi?: string; pmh?: string; familyHistory?: string;
  soap: { subjective?: string; objective?: string; assessment?: string; plan?: string };
  diagnoses?: Array<{ kcdCode?: string; name?: string; type?: string; certainty?: string }>;
  doctor?: { name?: string; license?: string };
  signedAt?: string;
}

const VISIT_LABEL: Record<string, string> = { OUTPATIENT: '외래', INPATIENT: '입원', ER_CONSULT: '응급협진', INPATIENT_CONSULT: '입원협진' };

/** 진료기록지 (ENCOUNTER_RECORD) — 순수 컴포넌트. 자유서식은 단일 페이지 흐름(인쇄 시 자동 분할). */
export function EncounterRecordDoc({ data, meta }: { data: EncounterRecordData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const Row = ({ label, value }: { label: string; value?: string }) =>
    value ? (
      <tr className="doc-row"><th style={{ width: '16%', background: '#f3f4f6', textAlign: 'left' }}>{label}</th><td style={{ whiteSpace: 'pre-wrap' }}>{value}</td></tr>
    ) : null;

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title={documentTitle('ENCOUNTER_RECORD')} />

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ width: '16%', background: '#f3f4f6' }}>환자</th>
            <td style={{ width: '38%' }}>{data.patient.name ?? '-'} {data.patient.mrn ? `(${data.patient.mrn})` : ''}</td>
            <th style={{ width: '16%', background: '#f3f4f6' }}>진료구분/일시</th>
            <td>{[VISIT_LABEL[data.visitType ?? ''] ?? data.visitType, data.date ? safeFormat(data.date, 'yyyy-MM-dd HH:mm') : ''].filter(Boolean).join(' / ') || '-'}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <Row label="주호소(C.C.)" value={data.cc} />
          <Row label="현병력(HPI)" value={data.hpi} />
          <Row label="과거력(PMH)" value={data.pmh} />
          <Row label="가족력" value={data.familyHistory} />
          <Row label="S (주관적)" value={data.soap.subjective} />
          <Row label="O (객관적)" value={data.soap.objective} />
          <Row label="A (평가)" value={data.soap.assessment} />
          <Row label="P (계획)" value={data.soap.plan} />
        </tbody>
      </table>

      {(data.diagnoses?.length ?? 0) > 0 && (
        <table style={{ marginBottom: 10 }}>
          <thead><tr><th style={{ background: '#f3f4f6', width: '20%' }}>질병분류기호</th><th style={{ background: '#f3f4f6', textAlign: 'left' }}>진단명</th><th style={{ background: '#f3f4f6', width: '16%' }}>구분</th></tr></thead>
          <tbody>
            {data.diagnoses!.map((d, i) => (
              <tr className="doc-row" key={i}><td style={{ textAlign: 'center' }}>{d.kcdCode ?? '-'}</td><td><span style={d.certainty === 'EXCLUDED' ? { textDecoration: 'line-through', color: '#999' } : undefined}>{d.name ?? '-'}</span>{d.certainty === 'PROVISIONAL' ? ' 의증' : d.certainty === 'RULE_OUT' ? ' (R/O)' : d.certainty === 'EXCLUDED' ? ' (배제)' : ''}</td><td style={{ textAlign: 'center' }}>{d.type === 'PRIMARY' ? '주' : d.type === 'SECONDARY' ? '부' : d.type === 'DIFFERENTIAL' ? '감별' : (d.type ?? '')}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <SignatureBlock label="진료의" signer={{ name: data.doctor?.name, license: data.doctor?.license }} />
      <div style={{ marginTop: 12 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt ?? data.signedAt} issuedBy={data.doctor?.name} />
    </section>
  );
}
