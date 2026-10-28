import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { SignatureBlock } from '../SignatureBlock';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { documentTitle } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

export interface PrescriptionData {
  patient: { name?: string; rrn?: string; mrn?: string };
  diagnoses?: Array<{ kcdCode?: string; name?: string }>;
  prescriber?: { name?: string; license?: string };
  dispensingType?: 'INTERNAL' | 'EXTERNAL';
  rxValidUntil?: string;
  issuedAt?: string;
  drugs: Array<{ name?: string; doseOnce?: string; freqPerDay?: string; days?: number | string; route?: string; instructions?: string }>;
}

const DISP: Record<string, string> = { INTERNAL: '원내조제', EXTERNAL: '원외처방' };

/** 처방전 (PRESCRIPTION) — 의료법 시행규칙 별지 제9호 양식 준거. 순수 컴포넌트. */
export function PrescriptionDoc({ data, meta }: { data: PrescriptionData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const kcd = (data.diagnoses ?? []).map((d) => d.kcdCode).filter(Boolean).join(', ') || '-';
  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title={documentTitle('PRESCRIPTION')} />

      <table style={{ marginBottom: 8 }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ width: '14%', background: '#f3f4f6' }}>환자 성명</th>
            <td style={{ width: '36%' }}>{data.patient.name ?? '-'}</td>
            <th style={{ width: '14%', background: '#f3f4f6' }}>주민등록번호</th>
            <td>{data.patient.rrn ?? '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6' }}>질병분류기호</th>
            <td>{kcd}</td>
            <th style={{ background: '#f3f4f6' }}>교부번호 / 일자</th>
            <td>{(meta?.issueNo ?? '(미발급)')} / {data.issuedAt ? safeFormat(data.issuedAt, 'yyyy-MM-dd') : '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6' }}>처방구분</th>
            <td>{DISP[data.dispensingType ?? ''] ?? '-'}</td>
            <th style={{ background: '#f3f4f6' }}>사용기간</th>
            <td>{data.rxValidUntil ? `교부일로부터 ${safeFormat(data.rxValidUntil, 'yyyy-MM-dd')}까지` : '교부일로부터 3일'}</td>
          </tr>
        </tbody>
      </table>

      <table>
        <thead>
          <tr>
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>의약품 명칭</th>
            <th style={{ background: '#f3f4f6', width: '15%' }}>1회 투약량</th>
            <th style={{ background: '#f3f4f6', width: '13%' }}>1일 투여횟수</th>
            <th style={{ background: '#f3f4f6', width: '12%' }}>총 투약일수</th>
            <th style={{ background: '#f3f4f6', width: '22%' }}>용법</th>
          </tr>
        </thead>
        <tbody>
          {data.drugs.length === 0 ? (
            <tr className="doc-row"><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>처방 의약품 없음</td></tr>
          ) : data.drugs.map((d, i) => (
            <tr className="doc-row" key={i}>
              <td>{d.name ?? '-'}</td>
              <td style={{ textAlign: 'center' }}>{d.doseOnce ?? '-'}</td>
              <td style={{ textAlign: 'center' }}>{d.freqPerDay ?? '-'}</td>
              <td style={{ textAlign: 'center' }}>{d.days != null ? `${d.days}일` : '-'}</td>
              <td>{[d.route, d.instructions].filter(Boolean).join(' / ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: '8pt', color: '#666', marginTop: 8 }}>
        ※ 본 처방전은 의료법 시행규칙 별지 제9호서식에 준합니다. {data.dispensingType === 'EXTERNAL' ? '약국 제출용.' : ''}
      </p>

      <SignatureBlock label="처방 의사" signer={{ name: data.prescriber?.name, license: data.prescriber?.license }} stampUrl={hospital.stampUrl} />
      <div style={{ marginTop: 12 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt ?? data.issuedAt} issuedBy={data.prescriber?.name} />
    </section>
  );
}
