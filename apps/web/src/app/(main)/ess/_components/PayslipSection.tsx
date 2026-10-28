'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T, Tf, useTfAttr } from '@/components/ui/i18n-text';
import type { ErpReadFailure } from '@hospital-run/shared';
import { ErpFailureNote } from './ErpFailureNote';

interface Line { code: string; kind?: string; amount: number }
interface Payslip { employeeNumber?: string; period?: string; issued?: boolean; gross?: number; net?: number; deductions?: Line[]; items?: Line[]; issuedAt?: string }
/** 🔴 R59 — `available:false` 에는 서버가 가른 사유(`failure` · shared 어휘)와 상류 상태가 실린다. 화면은 그것을 읽는다. */
interface ErpUnavailableFields { reason?: string; failure?: ErpReadFailure; upstreamStatus?: number | null }
interface PayslipResp extends ErpUnavailableFields {
  available: boolean;
  requestedPeriod?: string; issued?: boolean; periodMismatch?: boolean;
  payslip?: Payslip;
}
interface WithholdingResp extends ErpUnavailableFields {
  available: boolean;
  requestedYear?: string; returnedYear?: string | null; yearMismatch?: boolean;
  receipt?: { issued?: boolean; year?: number | string };
}

// 🔴 자료가 없는 것을 0원이라 말하지 않는다(P1) — 숫자가 아니면 '—'.
const won = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ko-KR') + '원' : '—');
const LABEL: Record<string, string> = {
  BASE: '기본급', OT: '연장근로수당', NIGHT: '야간근로수당', HOLIDAY: '휴일근로수당', MEAL: '식대', POSITION: '직책수당', BONUS: '상여금', ALLOWANCE: '수당',
  NP: '국민연금', HI: '건강보험', LTC: '장기요양보험', EI: '고용보험', TAX: '소득세', LOCALTAX: '지방소득세',
};
const lbl = (c: string) => LABEL[c] ?? c;

export function PayslipSection() {
  // 기간 표기(YYYYMM → 'YYYY년 MM월') — 자리표시자 보간으로 로케일을 탄다(ko 는 글자 단위로 종전과 같다)
  const tfAttr = useTfAttr();
  const fmtPeriod = (p: string) => (p?.length === 6 ? tfAttr('{년}년 {월}월', { 년: p.slice(0, 4), 월: p.slice(4) }) : p);
  const periods = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }, []);
  const [period, setPeriod] = useState(periods[0]);
  const q = useQuery({
    queryKey: ['ess-payslip', period],
    queryFn: () => apiClient.get<{ data: PayslipResp }>(`/api/v1/ess/payslip?period=${period}`),
  });
  const r = q.data?.data;
  const slip = r?.payslip;

  // 🔴 P1/P11 — '확정된 급여명세' 하나로 뭉개던 세 가지 사실을 갈라 말한다.
  //   구 코드는 `slip` 이 truthy 라는 이유만으로 확정분처럼 렌더해 issued:false 응답에
  //   won(undefined) → "실수령액 0원 · 총 지급 0원 · 총 공제 -0원" 으로 **미확정 급여를 0원이라 단언**했다.
  //   또 ERP 장애(available:false, reason:'ERP_UNAVAILABLE')를 미발행과 똑같은 문구로 표시해
  //   "장애라서 모른다"와 "아직 안 나왔다"를 구분할 수 없었다.
  const issued = (r?.issued ?? slip?.issued) === true;
  const erpDown = !q.isLoading && r?.available === false;
  const noRecord = !q.isLoading && r?.available === true && !slip;   // ERP 는 답했지만 해당 월 자료 자체가 없음
  const notIssued = !q.isLoading && !!slip && !issued;               // 자료는 있으나 아직 확정(발행) 전
  // ERP 가 요청과 다른 기간을 돌려준 경우 — 남의 달 명세를 이 달로 라벨링하지 않는다
  const shownPeriod = slip?.period ?? r?.requestedPeriod ?? period;

  // 지급 항목 — ERP `items` 에는 공제행(kind:'DEDUCTION')이 섞여 온다(실측).
  // 구 코드는 전부 '지급 항목'으로 찍어 항목 합(3,330,448)과 총 지급(2,900,478)이 어긋났다.
  const rawItems = slip?.items ?? [];
  const hasKind = rawItems.some((i) => !!i.kind);
  const earnings = hasKind ? rawItems.filter((i) => i.kind === 'EARNING') : rawItems;
  const deductions = slip?.deductions ?? [];
  const deductionTotal = deductions.length ? deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0) : undefined;

  // 원천징수영수증(연말정산·ERP) — 선택 기간의 연도
  const whYear = period.slice(0, 4);
  const wh = useQuery({
    queryKey: ['ess-withholding', whYear],
    queryFn: (): Promise<WithholdingResp> =>
      apiClient.get<{ data: WithholdingResp }>(`/api/v1/ess/withholding-receipt?year=${whYear}`).then((x) => x.data),
  });
  // 🔴 라벨은 요청 연도가 아니라 **응답이 말하는 귀속연도**로 붙인다.
  //   구 코드는 요청 연도(whYear)로 라벨링하고 응답 year 를 보지 않아
  //   ERP 가 2025 발급분을 돌려주면 "2026년 귀속"으로 표시될 수 있었다.
  const whReturnedYear = wh.data?.returnedYear ?? (wh.data?.receipt?.year != null ? String(wh.data.receipt.year) : null);
  const whLabelYear = whReturnedYear ?? whYear;
  const whMismatch = wh.data?.yearMismatch === true || (!!whReturnedYear && whReturnedYear !== whYear);
  const whIssued = wh.data?.available === true && wh.data.receipt?.issued === true;
  // 🔴 조회 실패도 '확인 불가'다 — `isError` 를 빼면 실패가 "발급 전"으로 읽힌다
  const whErpDown = !wh.isLoading && (wh.isError || wh.data?.available === false);

  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm"><T k="급여명세" /> <span className="font-normal text-slate-400 text-xs"><T k="(ERP 확정분)" /></span></h2>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
          {periods.map((p) => <option key={p} value={p}>{fmtPeriod(p)}</option>)}
        </select>
      </div>

      {q.isLoading && <p className="text-xs text-slate-400"><T k="불러오는 중…" /></p>}

      {/* ① ERP 장애 — 확정 여부를 '모른다'(없다가 아니다).
          🔴 종전엔 미설정·키 거부·망 단절이 전부 "연결하지 못해" 한 문장이었다 — 서버는 2026-09-22 부터
             `failure` 로 갈라 보냈는데 화면이 읽지 않았다. 사유 문장은 ErpFailureNote(어휘 = shared) 하나에서 나온다. */}
      {erpDown && (
        <ErpFailureNote failure={r?.failure} upstreamStatus={r?.upstreamStatus} onRetry={() => q.refetch()}>
          <Tf k="{기간} 급여명세를 확인할 수 없습니다" params={{ 기간: fmtPeriod(period) }} />
        </ErpFailureNote>
      )}

      {/* ② ERP 는 답했으나 해당 월 자료 없음 */}
      {noRecord && <p className="text-xs text-slate-400"><Tf k="{기간} 급여 자료가 없습니다." params={{ 기간: fmtPeriod(period) }} /></p>}

      {/* ③ 자료는 있으나 미발행 — 0원이 아니라 '아직 확정 전' */}
      {notIssued && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-500">
          {/* 한 문장 한 키 — 주어(`급여는`)만 생한글로 남던 조각 배선을 보간으로 합쳤다(굵은 강조는 문장 단위로 옮겼다) */}
          <Tf k="{기간} 급여는 아직 확정(발행) 전입니다 — 금액은 확정 후 표시됩니다." params={{ 기간: fmtPeriod(shownPeriod) }} className="font-semibold text-slate-700" />
        </div>
      )}

      {r?.periodMismatch && slip && (
        <p className="text-[11px] text-amber-600"><Tf k="⚠ 요청 {요청} · 응답 {응답} — 급여시스템이 다른 기간을 반환했습니다(인사팀 확인 필요)" params={{ 요청: fmtPeriod(period), 응답: fmtPeriod(shownPeriod) }} /></p>
      )}

      {slip && issued && (
        <div className="space-y-3">
          {/* 실수령 */}
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 flex items-baseline justify-between">
            <span className="text-xs text-blue-500"><T k="실수령액" /> <span className="text-blue-400">({fmtPeriod(shownPeriod)})</span></span>
            <span className="text-xl font-bold text-blue-700">{won(slip.net)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 지급 */}
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1"><T k="지급 항목" /></p>
              <div className="text-xs text-slate-600 space-y-0.5">
                {earnings.map((it, i) => (
                  <div key={i} className="flex justify-between"><span><T k={lbl(it.code)} /></span><span>{won(it.amount)}</span></div>
                ))}
                {earnings.length === 0 && <span className="text-slate-400"><T k="항목 내역 없음" /></span>}
                <div className="flex justify-between font-semibold border-t border-slate-100 pt-0.5 mt-0.5"><span><T k="총 지급" /></span><span>{won(slip.gross)}</span></div>
              </div>
            </div>
            {/* 공제 */}
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1"><T k="공제 항목" /></p>
              <div className="text-xs text-slate-600 space-y-0.5">
                {deductions.map((d, i) => (
                  <div key={i} className="flex justify-between"><span><T k={lbl(d.code)} /></span><span className="text-red-500">-{won(d.amount)}</span></div>
                ))}
                {deductions.length === 0 && <span className="text-slate-400"><T k="항목 내역 없음" /></span>}
                <div className="flex justify-between font-semibold border-t border-slate-100 pt-0.5 mt-0.5">
                  <span><T k="총 공제" /></span>
                  <span className="text-red-500">{deductionTotal == null ? '—' : `-${won(deductionTotal)}`}</span>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400"><T k="※ 급여 산정·지급은 급여시스템(ERP)이 확정합니다. 문의는 인사팀." /></p>
        </div>
      )}

      {/* 원천징수영수증(연말정산) */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs gap-2">
        <span className="text-slate-500"><T k="원천징수영수증" /> <span className="text-slate-400">({/* 🔴 `귀속`(과세 귀속연도)은 급여 법정 어휘라 의도적 미등재 — 조각(`년@단위`=years + 귀속)으로 두면
             영어에서 "2026 years 귀속" 이 되던 것을 한 키로 합쳤다. 미등재라 원문+티로 나간다(comp3 헤더) */}<Tf k="{연도}년 귀속" params={{ 연도: whLabelYear }} />)</span></span>
        {wh.isLoading
          ? <span className="text-slate-400"><T k="확인 중…" /></span>
          : whErpDown
            ? (
              // 🔴 조회 실패(isError)와 ERP 가 가른 사유(available:false·failure)는 다른 자리 — 사유가 있으면 그것을 읽는다
              wh.data?.available === false
                ? <ErpFailureNote failure={wh.data.failure} upstreamStatus={wh.data.upstreamStatus} onRetry={() => void wh.refetch()} className="text-amber-600 text-right" />
                : (
                  <span className="text-amber-600">
                    <T k="확인 불가(ERP 연결 실패)" />
                    <button type="button" onClick={() => void wh.refetch()} className="ml-1.5 underline"><T k="재시도" /></button>
                  </span>
                )
            )
            : whIssued
              ? <span className="text-emerald-600"><T k="발급 완료" /></span>
              : <span className="text-slate-400"><T k="발급 전(연말정산 후 제공)" /></span>}
      </div>
      {whMismatch && (
        <p className="text-[11px] text-amber-600"><Tf k="⚠ 요청 {요청}년 · 응답 {응답}년 귀속 — 급여시스템이 다른 연도를 반환했습니다(인사팀 확인 필요)" params={{ 요청: whYear, 응답: whReturnedYear ?? '' }} /></p>
      )}
    </section>
  );
}
