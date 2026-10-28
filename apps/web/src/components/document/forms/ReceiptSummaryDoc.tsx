import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

/** IssuedDocument(RECEIPT) 스냅샷 — billing.issueReceipt / F-4 번들 동봉 발급이 동일 스키마(PHI 최소화: MRN만) */
export interface ReceiptSummaryData {
  billingId?: string;
  mrn?: string;
  treatedOn?: string;
  department?: string | null;
  totalAmount?: number;
  insuranceCovered?: number;
  patientCopay?: number;
  discountAmount?: number;
  paidAmount?: number | null;
  /** 환불액 — P2-5 이후 발급분부터 · 옛 발급엔 없다 */
  refundAmount?: number | null;
  status?: string | null;
  receiptNo?: string | null;
  copayCategory?: string | null;
  eligibilityStatus?: string | null;
}

const won = (n?: number | null) => (n != null ? n.toLocaleString() : '-');

/** 진료비 영수증(발급 동결본) — 헤드리스 PDF 렌더용. 순수 컴포넌트 */
export function ReceiptSummaryDoc({ data, meta }: { data: ReceiptSummaryData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const th: React.CSSProperties = { background: '#f3f4f6', border: '1px solid #999', padding: '4px 6px', fontSize: '9pt', width: '30%', textAlign: 'left' };
  const td: React.CSSProperties = { border: '1px solid #bbb', padding: '4px 6px', fontSize: '9pt', textAlign: 'right' };

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title="진료비 영수증" />

      <table style={{ marginBottom: 10, width: '100%' }}>
        <tbody>
          <tr className="doc-row">
            <th style={th}>환자 등록번호</th>
            <td style={{ ...td, textAlign: 'left' }}>{data.mrn ?? '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={th}>진료 일자</th>
            <td style={{ ...td, textAlign: 'left' }}>
              {data.treatedOn ? safeFormat(data.treatedOn, 'yyyy-MM-dd') : '-'}
              {data.department ? ` · ${data.department}` : ''}
            </td>
          </tr>
          {data.receiptNo ? (
            <tr className="doc-row">
              <th style={th}>수납 영수번호</th>
              <td style={{ ...td, textAlign: 'left' }}>{data.receiptNo}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <th style={th}>진료비 총액</th>
            <td style={td}>{won(data.totalAmount)}원</td>
          </tr>
          <tr>
            <th style={th}>보험자(공단) 부담</th>
            <td style={td}>{won(data.insuranceCovered)}원</td>
          </tr>
          <tr>
            <th style={th}>본인 부담금</th>
            <td style={td}>{won(data.patientCopay)}원</td>
          </tr>
          <tr>
            <th style={th}>감면 금액</th>
            <td style={td}>{won(data.discountAmount ?? 0)}원</td>
          </tr>
          <tr>
            <th style={{ ...th, fontWeight: 700 }}>납부한 금액{data.status === 'PARTIAL' ? ' (부분 납부)' : ''}</th>
            <td style={{ ...td, fontWeight: 700 }}>{won(data.paidAmount)}원</td>
          </tr>
          {/* 🔴 (P2-5) 환불을 빼지 않고 "납부한 금액"만 찍으면 환불 받은 돈까지 낸 돈으로 읽힌다 */}
          {data.refundAmount != null && data.refundAmount > 0 && (
            <>
              <tr>
                <th style={th}>환불 금액</th>
                <td style={td}>-{won(data.refundAmount)}원</td>
              </tr>
              <tr>
                <th style={{ ...th, fontWeight: 700 }}>실제 부담한 금액</th>
                <td style={{ ...td, fontWeight: 700 }}>{won((data.paidAmount ?? 0) - (data.refundAmount ?? 0))}원</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <p style={{ fontSize: '7.5pt', color: '#666', marginTop: 8 }}>
        ※ 발급 시점 수납 기록을 동결한 영수증 사본입니다. 세부 산정 내역은 진료비 세부산정내역서를 참조하세요.
        {data.eligibilityStatus === 'EXPIRED' ? ' (건강보험 자격상실로 전액 본인부담 처리분 포함)' : ''}
      </p>
      <div style={{ marginTop: 10 }}>
        <IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} />
      </div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt} />
    </section>
  );
}
