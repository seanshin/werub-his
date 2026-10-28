import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { SignatureBlock } from '../SignatureBlock';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

export interface DeathCertificateData {
  patient: { name?: string; rrn?: string; mrn?: string; sex?: string; birth?: string; address?: string };
  death?: {
    deathDate?: string;
    deathLocation?: string | null; // HOSPITAL|ER|OR|ICU|OTHER — 원내 구역 코드(법정 서식의 상세주소와 층위가 다름 — 표기 캐비아트)
    deathType?: string | null; // NATURAL|EXTERNAL|OTHER
    causeChain?: { a?: string; b?: string; c?: string; d?: string };
    certKind?: 'DEATH_CERT' | 'POSTMORTEM';
  };
  purpose?: string;
  doctor?: { name?: string; license?: string };
  issuedAt?: string;
}

const LOCATION_LABEL: Record<string, string> = { HOSPITAL: '병원(병실)', ER: '병원(응급실)', OR: '병원(수술실)', ICU: '병원(중환자실)', OTHER: '기타' };
const DEATH_TYPE_LABEL: Record<string, string> = { NATURAL: '병사', EXTERNAL: '외인사', OTHER: '기타 및 불상' };

/**
 * 사망진단서(시체검안서) — 의료법 시행규칙 별지 제6호 서식 준거(진단서/검안서 동일 서식 한 장 — certKind 로 전환).
 * 🔴 서식 문안·항목 최종 확정은 법무/원무 확인 대상(N-W1 §5) — 본 서식은 별지 제6호의 필수 항목을 준거로 작성.
 * 사망 원인별 기간(발병~사망)·수술/부검 소견은 원천 데이터가 없어 공란으로 둔다(지어내지 않는다).
 */
export function DeathCertificateDoc({ data, meta }: { data: DeathCertificateData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const fdt = (d?: string | null) => (d ? safeFormat(d, 'yyyy-MM-dd HH:mm') : '-');
  const d = data.death ?? {};
  const chain = d.causeChain ?? {};
  const title = d.certKind === 'POSTMORTEM' ? '시체검안서' : '사망진단서';

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title={title} />

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
            <th style={{ background: '#f3f4f6' }}>등록번호</th>
            <td>{data.patient.mrn ?? '-'}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ width: '20%', background: '#f3f4f6', textAlign: 'left' }}>사망 일시</th>
            <td>{fdt(d.deathDate)}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>사망 장소</th>
            <td>{d.deathLocation ? (LOCATION_LABEL[d.deathLocation] ?? d.deathLocation) : '-'} <span style={{ fontSize: '8pt', color: '#888' }}>(원내 구역 기준)</span></td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>사망의 종류</th>
            <td>{d.deathType ? (DEATH_TYPE_LABEL[d.deathType] ?? d.deathType) : '-'}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th colSpan={2} style={{ background: '#f3f4f6', textAlign: 'left' }}>사망의 원인</th>
          </tr>
          <tr className="doc-row">
            <th style={{ width: '30%', background: '#fafafa', textAlign: 'left' }}>(가) 직접 사인</th>
            <td>{chain.a || '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#fafafa', textAlign: 'left' }}>(나) (가)의 원인</th>
            <td>{chain.b || '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#fafafa', textAlign: 'left' }}>(다) (나)의 원인</th>
            <td>{chain.c || '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#fafafa', textAlign: 'left' }}>(라) (다)의 원인</th>
            <td>{chain.d || '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>용도</th>
            <td>{data.purpose || '-'}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: '9pt', marginTop: 8 }}>위와 같이 {d.certKind === 'POSTMORTEM' ? '검안합니다' : '진단합니다'}.</p>
      <p style={{ textAlign: 'center', fontSize: '10pt', margin: '10px 0' }}>{data.issuedAt ? safeFormat(data.issuedAt, 'yyyy-MM-dd') : meta?.issuedAt ? safeFormat(meta.issuedAt, 'yyyy-MM-dd') : '-'}</p>

      <SignatureBlock label={d.certKind === 'POSTMORTEM' ? '검안 의사' : '진단 의사'} signer={{ name: data.doctor?.name, license: data.doctor?.license }} stampUrl={hospital.stampUrl} />
      <p style={{ fontSize: '8pt', color: '#666', marginTop: 4 }}>※ 의료법 시행규칙 별지 제6호 서식 준거. 사인은 사망 처리 시 기록된 사인체인(가~라) 원문에 근거함.</p>
      <div style={{ marginTop: 10 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt ?? data.issuedAt} issuedBy={data.doctor?.name} />
    </section>
  );
}
