import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { SignatureBlock } from '../SignatureBlock';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { documentTitle } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

export interface CertificateData {
  patient: { name?: string; rrn?: string; mrn?: string; sex?: string; birth?: string; address?: string };
  diagnoses?: Array<{ kcdCode?: string; name?: string }>;
  onsetDate?: string;       // 발병연월일
  diagnosedDate?: string;   // 진단연월일
  treatmentOpinion?: string; // 향후 치료 의견
  purpose?: string;         // 용도
  doctor?: { name?: string; license?: string };
  issuedAt?: string;
  /** 소견서 본문(작성 dto content) — 종전 양식은 그리지 않아 빠졌다(B7) */
  content?: string | null;
  /** 입퇴원확인서 — 서버가 원장에서 실은 입원(B7) · 퇴원 null = 재원 중 */
  admission?: { admissionId?: string; admitDate?: string; dischargeDate?: string | null } | null;
}

/** 서식 종류 — 같은 틀을 쓰되 문구·칸이 다르다(🔴 B7 종전엔 제목만 바꿔 입퇴원확인서·소견서가 "위와 같이 진단합니다"로 나갔다) */
export type CertificateKind = 'CERTIFICATE' | 'OPINION' | 'ADMISSION_CERT';
const KIND_TEXT: Record<CertificateKind, { statement: string; signer: string; note: string }> = {
  CERTIFICATE: { statement: '위와 같이 진단합니다.', signer: '진단 의사', note: '※ 의료법 시행규칙에 따른 진단서. 병명은 통계법 제22조 한국표준질병·사인분류(KCD)에 따름.' },
  OPINION: { statement: '위와 같이 소견합니다.', signer: '소견 의사', note: '※ 소견서. 병명은 한국표준질병·사인분류(KCD)에 따름.' },
  ADMISSION_CERT: { statement: '위와 같이 입원(및 퇴원)하였음을 확인합니다.', signer: '확인 의사', note: '※ 입퇴원 사실 확인서. 입원·퇴원 일자는 병원 입원 원장 기록.' },
};

/** 진단서/소견서/입퇴원확인서 (CERTIFICATE 계열) — 의료법 시행규칙 서식 준거. 순수 컴포넌트.
 *  title 미지정 시 진단서. 소견서·입퇴원확인서는 title 로 구분(동일 서식 재사용). */
export function CertificateDoc({ data, meta, title, kind = 'CERTIFICATE' }: { data: CertificateData; meta?: DocumentMeta; title?: string; kind?: CertificateKind }) {
  const hospital = useHospitalProfile();
  const text = KIND_TEXT[kind];
  const fdate = (d?: string) => (d ? safeFormat(d, 'yyyy-MM-dd') : '-');
  const dx = data.diagnoses ?? [];

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title={title ?? documentTitle('CERTIFICATE')} />

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ width: '16%', background: '#f3f4f6' }}>성명</th>
            <td style={{ width: '34%' }}>{data.patient.name ?? '-'}</td>
            <th style={{ width: '16%', background: '#f3f4f6' }}>주민등록번호</th>
            <td>{data.patient.rrn ?? '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6' }}>성별/생년</th>
            <td>{[data.patient.sex, data.patient.birth].filter(Boolean).join(' / ') || '-'}</td>
            <th style={{ background: '#f3f4f6' }}>주소</th>
            <td>{data.patient.address ?? '-'}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ width: '16%', background: '#f3f4f6', textAlign: 'left' }}>병명 (한국표준질병분류)</th>
            <td>
              {dx.length === 0 ? '-' : dx.map((d, i) => (
                <div key={i}>{d.name ?? ''} {d.kcdCode ? `[${d.kcdCode}]` : ''}</div>
              ))}
            </td>
          </tr>
          {kind === 'ADMISSION_CERT' ? (
            <>
              <tr className="doc-row" data-cert-admission>
                <th style={{ background: '#f3f4f6', textAlign: 'left' }}>입원 연월일</th>
                <td>{fdate(data.admission?.admitDate)}</td>
              </tr>
              <tr className="doc-row">
                <th style={{ background: '#f3f4f6', textAlign: 'left' }}>퇴원 연월일</th>
                <td>{!data.admission ? '-' : data.admission.dischargeDate ? fdate(data.admission.dischargeDate) : '재원 중'}</td>
              </tr>
            </>
          ) : (
            <>
              <tr className="doc-row">
                <th style={{ background: '#f3f4f6', textAlign: 'left' }}>발병 연월일</th>
                <td>{fdate(data.onsetDate)}</td>
              </tr>
              <tr className="doc-row">
                <th style={{ background: '#f3f4f6', textAlign: 'left' }}>진단 연월일</th>
                <td>{fdate(data.diagnosedDate)}</td>
              </tr>
            </>
          )}
          {kind === 'OPINION' && (
            <tr className="doc-row" data-cert-opinion-body>
              <th style={{ background: '#f3f4f6', textAlign: 'left' }}>소견</th>
              <td style={{ whiteSpace: 'pre-wrap', minHeight: 60 }}>{data.content || data.treatmentOpinion || '-'}</td>
            </tr>
          )}
          {kind !== 'ADMISSION_CERT' && (
            <tr className="doc-row">
              <th style={{ background: '#f3f4f6', textAlign: 'left' }}>향후 치료에 대한 소견</th>
              <td style={{ whiteSpace: 'pre-wrap', minHeight: 60 }}>{data.treatmentOpinion || '-'}</td>
            </tr>
          )}
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>용도</th>
            <td>{data.purpose || '-'}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: '9pt', marginTop: 8 }}>{text.statement}</p>
      <p style={{ textAlign: 'center', fontSize: '10pt', margin: '10px 0' }}>{fdate(data.issuedAt ?? meta?.issuedAt)}</p>

      <SignatureBlock label={text.signer} signer={{ name: data.doctor?.name, license: data.doctor?.license }} stampUrl={hospital.stampUrl} />
      <p style={{ fontSize: '8pt', color: '#666', marginTop: 4 }}>{text.note}</p>
      <div style={{ marginTop: 10 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt ?? data.issuedAt} issuedBy={data.doctor?.name} />
    </section>
  );
}
