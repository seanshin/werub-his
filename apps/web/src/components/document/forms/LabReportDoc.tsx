import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { SignatureBlock } from '../SignatureBlock';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { documentTitle } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';
import { isCriticalFlag, isAbnormalFlag, isHighFlag, isLowFlag, isJudgedFlag, LAB_FLAG_UNJUDGED_TEXT } from '@hospital-run/shared';

export interface LabReportData {
  patient: { name?: string; mrn?: string; sex?: string; birth?: string };
  order?: { orderedAt?: string; department?: string; doctorName?: string };
  specimen?: { collectedAt?: string; completedAt?: string; technicianName?: string };
  items: Array<{ testName: string; value?: string; unit?: string; normalMin?: number | null; normalMax?: number | null; flag?: string }>;
}

const ROWS_PER_PAGE = 24; // 페이지당 항목(설계 §12.4 의미 단위 분할)

/** 검사 성적서 (LAB_REPORT) — 순수 컴포넌트. 화면=인쇄=PDF 동일 마크업. */
export function LabReportDoc({ data, meta }: { data: LabReportData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const title = documentTitle('LAB_REPORT');
  const pages: typeof data.items[] = [];
  for (let i = 0; i < Math.max(data.items.length, 1); i += ROWS_PER_PAGE) pages.push(data.items.slice(i, i + ROWS_PER_PAGE));
  const totalN = pages.length;

  const fdate = (d?: string) => (d ? safeFormat(d, 'yyyy-MM-dd HH:mm') : '-');

  return (
    <>
      {pages.map((rows, pi) => (
        <section className="doc-page" key={pi}>
          <DocHeader hospital={hospital} title={title} />

          {pi === 0 && (
            <table style={{ marginBottom: 10 }}>
              <tbody>
                <tr className="doc-row">
                  <th style={{ width: '14%', background: '#f3f4f6' }}>환자</th>
                  <td style={{ width: '36%' }}>{data.patient.name ?? '-'} {data.patient.mrn ? `(${data.patient.mrn})` : ''}</td>
                  <th style={{ width: '14%', background: '#f3f4f6' }}>성별/생년</th>
                  <td>{[data.patient.sex, data.patient.birth].filter(Boolean).join(' / ') || '-'}</td>
                </tr>
                <tr className="doc-row">
                  <th style={{ background: '#f3f4f6' }}>처방과/의사</th>
                  <td>{[data.order?.department, data.order?.doctorName].filter(Boolean).join(' / ') || '-'}</td>
                  <th style={{ background: '#f3f4f6' }}>검체채취/완료</th>
                  <td>{fdate(data.specimen?.collectedAt)} ~ {fdate(data.specimen?.completedAt)}</td>
                </tr>
              </tbody>
            </table>
          )}

          <table>
            <thead>
              <tr>
                <th style={{ background: '#f3f4f6', textAlign: 'left' }}>검사항목</th>
                <th style={{ background: '#f3f4f6', textAlign: 'right', width: '18%' }}>결과</th>
                <th style={{ background: '#f3f4f6', width: '12%' }}>단위</th>
                <th style={{ background: '#f3f4f6', width: '22%' }}>참고치</th>
                <th style={{ background: '#f3f4f6', width: '10%' }}>판정</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="doc-row"><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>검사 항목 없음</td></tr>
              ) : rows.map((it, i) => {
                // 🔴 종전엔 `flag === 'H' || 'L'` 만 봤다 — **위급값(HH·LL·AA·C·CC·CRITICAL·PANIC)이
                //    환자에게 인쇄되는 성적서 판정 칸에 "정상"으로 찍혔다.** 정본 헤더가 지목한 위험 그 자체다.
                //    (`'Panic'` 분기는 정본 어휘가 `'PANIC'` 이라 대소문자가 달라 영원히 거짓이었다.)
                const crit = isCriticalFlag(it.flag);
                const abn = isAbnormalFlag(it.flag);
                // 🔴 미판정(flag 없음)을 "정상"이라 적지 않는다 — 모르는 것과 정상은 다른 사실이다.
                //    판정 여부는 shared 정본(`isJudgedFlag`)으로 본다 — 여기서 다시 적으면 화면과 갈라진다.
                const judged = isJudgedFlag(it.flag);
                const color = crit ? '#b91c1c' : isHighFlag(it.flag) ? '#dc2626' : isLowFlag(it.flag) ? '#2563eb' : '#111';
                const verdict = crit
                  ? `위급 ${isHighFlag(it.flag) ? 'HIGH' : isLowFlag(it.flag) ? 'LOW' : ''}`.trim()
                  : isHighFlag(it.flag) ? 'HIGH'
                  : isLowFlag(it.flag) ? 'LOW'
                  : abn ? '이상'
                  : judged ? '정상' : LAB_FLAG_UNJUDGED_TEXT;
                return (
                  <tr className="doc-row" key={i}>
                    <td>{it.testName}</td>
                    <td style={{ textAlign: 'right', fontWeight: abn || crit ? 700 : 400, color, fontVariantNumeric: 'tabular-nums' }}>
                      {it.value ?? '-'}{isHighFlag(it.flag) ? ' ▲' : isLowFlag(it.flag) ? ' ▼' : ''}{crit ? ' ⚠' : ''}
                    </td>
                    <td>{it.unit ?? ''}</td>
                    <td style={{ textAlign: 'center' }}>{it.normalMin != null && it.normalMax != null ? `${it.normalMin} – ${it.normalMax}` : '-'}</td>
                    <td style={{ textAlign: 'center', color, fontWeight: abn || crit ? 700 : 400 }}>{verdict}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {pi === totalN - 1 && (
            <>
              <SignatureBlock label="검사책임자" signer={{ name: data.specimen?.technicianName }} />
              <div style={{ marginTop: 12 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
            </>
          )}
          <DocFooter pageNo={pi + 1} totalN={totalN} issuedAt={meta?.issuedAt} issuedBy={meta?.issuedBy} />
        </section>
      ))}
    </>
  );
}
