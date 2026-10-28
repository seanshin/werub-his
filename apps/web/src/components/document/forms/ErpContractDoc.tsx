import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

/**
 * ERP 의료계약(ERP_MEDICAL_CONTRACT / ERP_OUTSOURCING_CONTRACT) 렌더 — 구조화 snapshot(JSON) → PDF.
 * ERP가 경영데이터를 구조화해 제공, HIS가 문서/렌더 담당(모델 분담). 필드는 유연(누락 시 생략).
 */
export interface ErpContractData {
  title?: string;          // 계약 제목(기본: 의료계약서)
  contractNo?: string;     // ERP 계약번호
  parties?: Array<{ role?: string; name?: string; position?: string; org?: string; license?: string }>; // 당사자(병원/직원)
  period?: { start?: string; end?: string }; // 계약기간
  compensation?: string;   // 보수
  fields?: Array<{ label?: string; value?: string }>; // 기타 키-값(직위·근무지 등)
  clauses?: Array<{ no?: string | number; title?: string; text?: string }>; // 조항
  note?: string;           // 비고
  signedAt?: string;
}

const fdate = (d?: string) => (d ? safeFormat(d, 'yyyy-MM-dd') : '-');

export function ErpContractDoc({ data, meta, title }: { data: ErpContractData; meta?: DocumentMeta; title?: string }) {
  const hospital = useHospitalProfile();
  const parties = data.parties ?? [];
  const fields = data.fields ?? [];
  const clauses = data.clauses ?? [];

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title={title ?? data.title ?? '의료계약서'} />

      {(data.contractNo || data.period || data.compensation) && (
        <table style={{ marginBottom: 10 }}>
          <tbody>
            {data.contractNo && (
              <tr className="doc-row">
                <th style={{ width: '18%', background: '#f3f4f6', textAlign: 'left' }}>계약번호</th>
                <td>{data.contractNo}</td>
              </tr>
            )}
            {data.period && (
              <tr className="doc-row">
                <th style={{ background: '#f3f4f6', textAlign: 'left' }}>계약기간</th>
                <td>{fdate(data.period.start)} ~ {fdate(data.period.end)}</td>
              </tr>
            )}
            {data.compensation && (
              <tr className="doc-row">
                <th style={{ background: '#f3f4f6', textAlign: 'left' }}>보수</th>
                <td>{data.compensation}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {parties.length > 0 && (
        <table style={{ marginBottom: 10 }}>
          <tbody>
            <tr className="doc-row"><th colSpan={4} style={{ background: '#eef2ff', textAlign: 'left' }}>당사자</th></tr>
            {parties.map((p, i) => (
              <tr className="doc-row" key={i}>
                <th style={{ width: '18%', background: '#f3f4f6' }}>{p.role || '당사자'}</th>
                <td style={{ width: '32%' }}>{[p.name, p.position].filter(Boolean).join(' / ') || '-'}</td>
                <th style={{ width: '14%', background: '#f3f4f6' }}>소속</th>
                <td>{[p.org, p.license].filter(Boolean).join(' · ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {fields.length > 0 && (
        <table style={{ marginBottom: 10 }}>
          <tbody>
            {fields.map((f, i) => (
              <tr className="doc-row" key={i}>
                <th style={{ width: '18%', background: '#f3f4f6', textAlign: 'left' }}>{f.label || '-'}</th>
                <td style={{ whiteSpace: 'pre-wrap' }}>{f.value || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {clauses.length > 0 && (
        <div style={{ marginBottom: 10, fontSize: '9pt' }}>
          {clauses.map((c, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>{c.no != null ? `제${c.no}조` : ''} {c.title || ''}</div>
              {c.text && <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{c.text}</div>}
            </div>
          ))}
        </div>
      )}

      {data.note && (
        <p style={{ fontSize: '9pt', whiteSpace: 'pre-wrap', marginTop: 8 }}>{data.note}</p>
      )}

      <p style={{ fontSize: '9pt', marginTop: 10 }}>위 계약 내용을 확인하고 전자서명에 동의합니다.</p>
      <p style={{ textAlign: 'center', fontSize: '10pt', margin: '10px 0' }}>{fdate(data.signedAt ?? meta?.issuedAt)}</p>

      <p style={{ fontSize: '8pt', color: '#666', marginTop: 4 }}>※ 본 문서는 전자서명(sign)으로 체결되며, 서명 완료 시 블록체인 인증서로 봉인됩니다.</p>
      <div style={{ marginTop: 10 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt} issuedBy={data.contractNo} />
    </section>
  );
}
