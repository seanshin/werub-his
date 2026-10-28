import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

interface BillLine {
  name?: string; category?: string; quantity?: number; unitPrice?: number; amount?: number;
  insurerShare?: number; copayPartial?: number; copayFull?: number; nonCovered?: number;
}
interface BillTotals { amount?: number; insurerShare?: number; copayPartial?: number; copayFull?: number; nonCovered?: number }
interface BillRow {
  billingId?: string; date?: string; department?: string | null; doctor?: string | null;
  items?: BillLine[]; totals?: BillTotals; billedCopay?: number; discountAmount?: number; paidAmount?: number | null;
}
export interface DetailedBillData {
  patient?: { name?: string; mrn?: string; birth?: string };
  period?: { from?: string; to?: string };
  visitScope?: string;
  billings?: BillRow[];
  grandTotal?: BillTotals;
}

const won = (n?: number) => (n && n > 0 ? n.toLocaleString() : '-');

/** F-4 진료비 세부산정내역서 — 영수증 fullCopay 5열(급여 공단/일부본인/전액본인·비급여) 항목별 분해. 순수 컴포넌트 */
export function DetailedBillDoc({ data, meta }: { data: DetailedBillData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const billings = data.billings ?? [];
  const g = data.grandTotal ?? {};
  const scope = data.visitScope === 'INPATIENT' ? '입원' : '외래';
  const th: React.CSSProperties = { background: '#f3f4f6', border: '1px solid #999', padding: '3px 4px', fontSize: '7.5pt' };
  const td: React.CSSProperties = { border: '1px solid #bbb', padding: '2px 4px', fontSize: '7.5pt' };
  const tdR: React.CSSProperties = { ...td, textAlign: 'right' };

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title="진료비 세부산정내역서" />

      <table style={{ marginBottom: 8, width: '100%' }}>
        <tbody>
          <tr className="doc-row">
            <th style={{ ...th, width: '14%' }}>성명</th>
            <td style={td}>{data.patient?.name ?? '-'}</td>
            <th style={{ ...th, width: '14%' }}>등록번호</th>
            <td style={td}>{data.patient?.mrn ?? '-'}</td>
            <th style={{ ...th, width: '14%' }}>구분</th>
            <td style={td}>{scope}</td>
          </tr>
          <tr className="doc-row">
            <th style={th}>대상 기간</th>
            <td style={td} colSpan={5}>
              {data.period?.from ?? '-'} ~ {data.period?.to ?? '-'}
            </td>
          </tr>
        </tbody>
      </table>

      {billings.map((b, bi) => (
        <div key={b.billingId ?? bi} style={{ marginBottom: 10 }}>
          <p style={{ fontSize: '8.5pt', fontWeight: 700, margin: '4px 0' }}>
            {b.date ? safeFormat(b.date, 'yyyy-MM-dd') : '-'}
            {b.department ? ` · ${b.department}` : ''}
            {b.doctor ? ` · ${b.doctor}` : ''}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>항목</th>
                <th style={th}>수량</th>
                <th style={th}>단가</th>
                <th style={th}>금액</th>
                <th style={th}>공단부담</th>
                <th style={th}>일부본인부담</th>
                <th style={th}>전액본인부담</th>
                <th style={th}>비급여</th>
              </tr>
            </thead>
            <tbody>
              {(b.items ?? []).map((it, i) => (
                <tr key={i}>
                  <td style={td}>{it.name ?? '-'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{it.quantity ?? '-'}</td>
                  <td style={tdR}>{won(it.unitPrice)}</td>
                  <td style={tdR}>{won(it.amount)}</td>
                  <td style={tdR}>{won(it.insurerShare)}</td>
                  <td style={tdR}>{won(it.copayPartial)}</td>
                  <td style={tdR}>{won(it.copayFull)}</td>
                  <td style={tdR}>{won(it.nonCovered)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...td, fontWeight: 700 }} colSpan={3}>소계</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{won(b.totals?.amount)}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{won(b.totals?.insurerShare)}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{won(b.totals?.copayPartial)}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{won(b.totals?.copayFull)}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{won(b.totals?.nonCovered)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: '20%' }}>총계</th>
            <td style={tdR}>진료비 총액 {won(g.amount)}원</td>
            <td style={tdR}>공단부담 {won(g.insurerShare)}원</td>
            <td style={tdR}>일부본인부담 {won(g.copayPartial)}원</td>
            <td style={tdR}>전액본인부담 {won(g.copayFull)}원</td>
            <td style={tdR}>비급여 {won(g.nonCovered)}원</td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: '7.5pt', color: '#666', marginTop: 8 }}>
        ※ 급여 항목은 본인부담률에 따라 공단부담/일부본인부담으로 구분하며, 급여 100분의100(전액본인부담)과 비급여는 별도 표기합니다.
      </p>
      <div style={{ marginTop: 10 }}>
        <IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} />
      </div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt} />
    </section>
  );
}
