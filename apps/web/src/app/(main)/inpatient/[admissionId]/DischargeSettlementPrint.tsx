'use client';

import { useMemo } from 'react';
import { joinPatientName } from '@hospital-run/shared';
import { PrintDoc, useDocHash, breakKey } from '@/components/print/PrintSheet';
import { KDate, Money } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

/**
 * 퇴원 정산서 인쇄본(2026-10-12) — 입원 상세 '퇴원 정산서' 카드의 '인쇄' 단추가 찍는 문서.
 *
 * 🔴 종전엔 빈 종이였다(공용 문서 CSS 가 인쇄 루트 없이도 body 직계를 숨겼다) → 인쇄 전용 문서로.
 * 이 문서가 지키는 것:
 *  · 🔴 서버가 주지 않은 금액은 **0원이 아니다** — "확인 불가"로 찍는다(화면 카드는 `?? 0` 으로 그린다 — 종이에는 옮기지 않는다)
 *  · 정산 대사 경고는 숨기지 않는다 — 있으면 표 위에
 *  · 서명란은 수납 담당·환자/보호자(받는 사람이 확인하는 문서)
 *  · 문서 QR 에는 PHI 를 넣지 않는다 — 종류·버전·입원 id·시각·잔액 유무만
 */

export interface DischargeSettlementData {
  admitDate?: string; dischargeDate?: string | null; days?: number;
  totalCharges?: number; totalCopay?: number; alreadyPaid?: number; balanceDue?: number;
  reconciliation?: { warnings?: string[] };
  breakdown?: {
    encounters?: { count?: number; charges?: number; copay?: number; paid?: number };
    interim?: { count?: number; charges?: number; copay?: number; paid?: number };
  };
}

export interface SettlementPrintAdmission {
  patient?: { id?: string; familyName?: string | null; givenName?: string | null; mrn?: string | null };
  bed?: { ward?: { name: string }; roomNumber: string; bedNumber: string };
  admitDate?: string; dischargeDate?: string | null;
}

/** 문서 QR — 🔴 PHI 없음(테스트가 대조) */
export function settlementQrPayload(p: { admissionId: string; at: string; balanceKnown: boolean }) {
  return { t: 'HIS-DISCHARGE-SETTLEMENT', v: 1, admission: p.admissionId, at: p.at, balanceKnown: p.balanceKnown };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 금액 칸 — 숫자가 아니면 "확인 불가"(0원으로 찍지 않는다) */
function Amount({ v }: { v: unknown }) {
  return isNum(v) ? <Money value={v} /> : <span data-print-unknown><T k="확인 불가" /></span>;
}

export function DischargeSettlementPrint({ admissionId, settlement: s, admission, printedAt }: {
  admissionId: string; settlement: DischargeSettlementData; admission?: SettlementPrintAdmission | null; printedAt?: string;
}) {
  const at = useMemo(() => printedAt ?? new Date().toISOString(), [printedAt]);
  const canon = [admissionId, s.totalCharges, s.totalCopay, s.alreadyPaid, s.balanceDue].map((x) => (x == null ? '' : String(x))).join('|');
  const hash = useDocHash(canon);
  const pt = admission?.patient;
  const name = pt ? joinPatientName(pt.familyName, pt.givenName) : '';
  const warnings = s.reconciliation?.warnings ?? [];
  const admitDate = s.admitDate ?? admission?.admitDate;
  const dischargeDate = s.dischargeDate ?? admission?.dischargeDate ?? null;
  const part = (b?: { count?: number; charges?: number; copay?: number; paid?: number }) => (
    <><td className="dps-nowrap">{isNum(b?.count) ? <>{b!.count}<T k="건" /></> : <T k="확인 불가" />}</td>
      <td><Amount v={b?.charges} /></td><td><Amount v={b?.copay} /></td><td><Amount v={b?.paid} /></td></>
  );

  return (
    <PrintDoc
      attr="DISCHARGE_SETTLEMENT"
      kind={<T k="퇴원 정산서" />}
      code="HIS-DISCHARGE-SETTLEMENT v1"
      title={<T k="퇴원 정산서" />}
      subtitle={<><T k="출력 시각" /> <KDate value={at} mode="datetime" /></>}
      idLine={breakKey(admissionId)}
      qr={settlementQrPayload({ admissionId, at, balanceKnown: isNum(s.balanceDue) })}
      hash={hash} unissued="PENDING_D2"
      signOff={false}
    >
      <h2><T k="환자·입원" /></h2>
      <table className="dps-kv" data-print-section="IDENTITY">
        <tbody>
          <tr><th><T k="이름" /></th><td>{name || <span data-print-unknown><T k="확인 불가" /></span>}</td><th><T k="등록번호" /></th><td className="dps-mono">{pt?.mrn || <T k="확인 불가" />}</td></tr>
          <tr>
            <th><T k="입원일" /></th><td>{admitDate ? <KDate value={admitDate} mode="date" /> : <T k="확인 불가" />}</td>
            <th><T k="퇴원일" /></th><td>{dischargeDate ? <KDate value={dischargeDate} mode="date" /> : <T k="재원 중" />}</td>
          </tr>
          <tr>
            <th><T k="재원 일수" /></th><td>{isNum(s.days) ? <>{s.days}<T k="일" /></> : <T k="확인 불가" />}</td>
            <th><T k="병상" /></th><td>{admission?.bed ? `${admission.bed.ward?.name ?? ''} ${admission.bed.roomNumber}-${admission.bed.bedNumber}`.trim() : '—'}</td>
          </tr>
        </tbody>
      </table>

      {warnings.length > 0 && (
        <div className="dps-box" data-print-warnings>
          <b><T k="정산 대사 경고" /></b>
          {warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
        </div>
      )}

      <h2><T k="정산 금액" /></h2>
      <table className="dps-kv" data-print-section="AMOUNTS">
        <tbody>
          <tr><th><T k="총진료비" /></th><td><Amount v={s.totalCharges} /></td></tr>
          <tr><th><T k="총 본인부담" /></th><td><Amount v={s.totalCopay} /></td></tr>
          <tr><th><T k="기납부(중간정산 포함)" /></th><td><Amount v={s.alreadyPaid} /></td></tr>
          <tr><th><b><T k="퇴원 수납 잔액" /></b></th><td data-print-balance><b><Amount v={s.balanceDue} /></b></td></tr>
        </tbody>
      </table>

      <h2><T k="구성" /></h2>
      <table data-print-section="BREAKDOWN">
        <thead><tr><th><T k="구분" /></th><th><T k="건수" /></th><th><T k="진료비" /></th><th><T k="본인부담" /></th><th><T k="납부" /></th></tr></thead>
        <tbody>
          <tr><td><T k="진료 청구" /></td>{part(s.breakdown?.encounters)}</tr>
          <tr><td><T k="중간정산" /></td>{part(s.breakdown?.interim)}</tr>
        </tbody>
      </table>

      {/* 범례는 서명란 위 — 서명하는 사람이 읽고 서명한다 */}
      <p className="dps-note" style={{ marginTop: '6pt' }}><T k="입원 전체 진료비를 합치고 중간정산으로 낸 금액을 뺀 잔액입니다. 확인 불가는 서버가 값을 주지 않은 칸입니다 — 0원이 아닙니다." /></p>
      <table className="dps-signoff" data-print-signoff>
        <tbody><tr>
          <th><T k="수납 담당" /></th><td />
          <th><T k="환자/보호자" /></th><td />
          <th><T k="일자" /></th><td />
        </tr></tbody>
      </table>
    </PrintDoc>
  );
}
