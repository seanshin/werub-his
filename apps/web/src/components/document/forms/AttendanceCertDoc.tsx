import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

export interface AttendanceCertData {
  patient?: { name?: string; mrn?: string; birth?: string; sex?: string };
  period?: { from?: string; to?: string };
  visits?: Array<{ date?: string; department?: string | null; doctor?: string | null }>;
  visitCount?: number;
}

/** F-4 통원확인서 — 기간 내 내원 일자·과·의사(수납 원천). 순수 컴포넌트 */
export function AttendanceCertDoc({ data, meta }: { data: AttendanceCertData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const visits = data.visits ?? [];
  const th: React.CSSProperties = { background: '#f3f4f6', border: '1px solid #999', padding: '3px 5px', fontSize: '8.5pt' };
  const td: React.CSSProperties = { border: '1px solid #bbb', padding: '3px 5px', fontSize: '8.5pt' };

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title="통원확인서" />

      <table style={{ marginBottom: 10, width: '100%' }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ ...th, width: '16%' }}>성명</th>
            <td style={{ ...td, width: '34%' }}>{data.patient?.name ?? '-'}</td>
            <th style={{ ...th, width: '16%' }}>등록번호</th>
            <td style={td}>{data.patient?.mrn ?? '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={th}>생년월일</th>
            <td style={td}>{data.patient?.birth ? safeFormat(String(data.patient.birth), 'yyyy-MM-dd') : '-'}</td>
            <th style={th}>확인 기간</th>
            <td style={td}>{data.period?.from ?? '-'} ~ {data.period?.to ?? '-'}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '10%' }}>번호</th>
            <th style={{ ...th, width: '30%' }}>내원 일자</th>
            <th style={{ ...th, width: '30%' }}>진료과</th>
            <th style={th}>담당의</th>
          </tr>
        </thead>
        <tbody>
          {visits.length === 0 ? (
            <tr><td style={{ ...td, textAlign: 'center' }} colSpan={4}>내원 이력 없음</td></tr>
          ) : (
            visits.map((v, i) => (
              <tr key={i}>
                <td style={{ ...td, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...td, textAlign: 'center' }}>{v.date ? safeFormat(v.date, 'yyyy-MM-dd') : '-'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{v.department ?? '-'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{v.doctor ?? '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <p style={{ fontSize: '9.5pt', margin: '14px 0' }}>
        위 환자는 상기 기간 중 본 의료기관에 총 {data.visitCount ?? visits.length}회 통원(외래 내원)하여 진료받았음을 확인합니다.
      </p>
      <p style={{ textAlign: 'center', fontSize: '10pt', margin: '10px 0' }}>
        {meta?.issuedAt ? safeFormat(meta.issuedAt, 'yyyy-MM-dd') : '-'}
      </p>
      <p style={{ textAlign: 'center', fontSize: '10pt', fontWeight: 700 }}>{hospital.name}</p>
      <p style={{ fontSize: '7.5pt', color: '#666', marginTop: 8 }}>
        ※ 본 확인서는 수납(진료비) 기록을 근거로 시스템이 자동 발급한 내원 사실 확인 문서이며, 진단·소견을 포함하지 않습니다.
      </p>
      <div style={{ marginTop: 10 }}>
        <IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} />
      </div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt} />
    </section>
  );
}
