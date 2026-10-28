'use client';
import { safeFormat } from '@/lib/safe-date';
import { ReasonInput } from '@/components/ui/ReasonInput';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { money } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { DOC_ISSUANCE_STATUS_LABEL } from '@hospital-run/shared';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useAuthStore } from '@/stores/auth-store';
import { ReceptionDocumentDesk } from './ReceptionDocumentDesk';
import { LedgerPanel } from './LedgerPanel';
import { issuanceStages } from './issuance-stages';
import { FeeBillingBadge, type FeeBilling } from './FeeBillingBadge';

type QueueItem = {
  id: string; type: string; status: string; copies: number; fee?: number; purpose?: string;
  recordTypes?: string[]; deliveryMethod: string; periodFrom?: string; periodTo?: string;
  createdAt: string; slaDueAt?: string; issuedDocumentId?: string; patient: { mrn?: string; name: string };
  receiptNumber?: string; deliveryDestination?: string | null; requesterType?: string; legalBasis?: string | null;
  requesterRelation?: string | null; proxyVerifyStatus?: string | null; rejectReason?: string | null;
  feeBilling?: FeeBilling | null;
};
type Artifact = { id: string; recordType: string; pageCount?: number; authoredJson?: CertForm | null; signedAt?: string | null; signedBy?: string | null };
type FeeBreakdown = { type: string; label: string; copies: number; pages: number; base: number; pageCharge: number; copyCharge: number; total: number; ruleSource: 'CONFIG' | 'DEFAULT' };
type Detail = {
  request: QueueItem & { artifacts: Artifact[]; deliveryRef?: string | null; deliveredAt?: string | null };
  available: Record<string, number>;
  estimatedFee?: FeeBreakdown;
  feeBilling?: FeeBilling | null;
};
type Report = {
  period: { from: string | null; to: string | null };
  totals: { requested: number; issued: number; delivered: number; feeSum: number; rejected: number };
  byStatus: Record<string, number>;
  byType: { type: string; count: number; feeSum: number }[];
  byDelivery: Record<string, number>;
  processing: { avgHours: number | null; slaBreaches: number; measured: number };
  /** 처리 시간·수령 방법·수수료 합을 센 발급 건(상한) — 잘리면 truncated */
  sample?: { counted: number; total: number; truncated: boolean };
};
// PORTAL — 환자 포털 신청의 기본 수령 방법(포털 다운로드). 종전 라벨 표에 없어 코드 문자열이 그대로 보였다(2026-10-10)
const DELIVERY_LABEL: Record<string, string> = { PORTAL: '포털 다운로드', VISIT: '방문', MAIL: '우편', FAX: '팩스' };

const REC_TYPES: [string, string][] = [
  ['ENCOUNTER', '진료기록'], ['PROGRESS', '경과기록'], ['NURSING', '간호기록'], ['DISCHARGE', '퇴원요약'], ['PRESCRIPTION', '처방내역'], ['CHRONIC', '만성질환 수치 추이'],
];
const REJECT_REASONS: [string, string][] = [
  ['NOT_ELIGIBLE', '청구권자 자격 미충족'], ['INSUFFICIENT_DOC', '구비서류 미비'], ['NO_RECORD', '해당 기록 없음'], ['DUPLICATE', '중복 신청'], ['OTHER', '기타'],
];
const STATUS_LABEL = DOC_ISSUANCE_STATUS_LABEL; // 정본(docIssuance — IN_REVIEW=작성중 통일)
const BGROUP = ['DIAGNOSIS_CERT', 'OPINION', 'ADMISSION_CERT', 'DEATH_CERT', 'BIRTH_CERT'];
const TYPE_LABEL: Record<string, string> = { MEDICAL_RECORD: '의무기록 사본', DIAGNOSIS_CERT: '진단서', OPINION: '소견서', ADMISSION_CERT: '입퇴원확인서' , DEATH_CERT: '사망진단서', BIRTH_CERT: '출생증명서'};
type CertForm = { encounterId?: string; admissionId?: string; diagnoses: { kcdCode?: string; name?: string }[]; onsetDate?: string; treatmentOpinion?: string; purpose?: string };
/** B7 입퇴원확인서 — 고를 입원(서버 원장) */
/** 로컬(KST) 날짜 — ISO 앞 10자를 자르면 UTC 날짜라 하루가 밀린다 */
const fmtDate = (v: string) => (v ? safeFormat(v, 'yyyy-MM-dd') : '');
type AdmissionPick = { id: string; admitDate: string; dischargeDate: string | null; status: string };

/**
 * 🔴 (2026-10-10 사용자 결정) 원무(RECEPTIONIST)는 접수·대기 목록만 — 의무기록 처리 화면(상세·작성·발급)을 그리지 않고 부르지도 않는다.
 */
export default function DocumentWorkstationPage() {
  const role = useAuthStore((st) => st.user?.role);
  if (role === 'RECEPTIONIST') return <ReceptionDocumentDesk />;
  return <DocumentWorkstation />;
}

function DocumentWorkstation() {
  /** 🔴 진단서 등 법정 문서의 작성·전자서명은 의사만이다(서버 `@Roles(DOCTOR)`) —
   *     큐 조회·발급은 간호·의무기록사도 하므로 그 자리는 그대로 둔다. */
  const canAuthor = useHasRole('DOCTOR');
  /** 처리 단계(상세·작성·동결·발급·수령·거절·리포트)는 의료진·의무기록사 — 원무는 접수·대기 목록만(2026-10-10 · 서버도 막는다) */
  const canProcess = useHasRole('NURSE', 'DOCTOR', 'MEDICAL_RECORDS');
  const tAttr = useTAttr();
  const [status, setStatus] = useState('REQUESTED');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<Detail | null>(null);
  const [recTypes, setRecTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejectMode, setRejectMode] = useState<{ reason: string; detail: string } | null>(null);
  const [cert, setCert] = useState<CertForm>({ diagnoses: [] });
  const [draftInfo, setDraftInfo] = useState<{ isAttending?: boolean; encounterId?: string | null; admissions?: AdmissionPick[] } | null>(null);
  const [deliverRef, setDeliverRef] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [search, setSearch] = useState('');
  /** 큐 조회 실패 — 종전엔 삼켜서 "요청이 없습니다"로 보였다(실패 ≠ 없음 · 2026-10-10) */
  const [queueFailed, setQueueFailed] = useState(false);

  const loadQueue = useCallback(async () => {
    try {
      const term = search.trim();
      const qs = new URLSearchParams({ status, ...(term ? { q: term } : {}) });
      const r = await apiClient.get<{ data: { items: QueueItem[]; stats: Record<string, number>; total?: number; truncated?: boolean } }>(`/api/v1/staff/document-requests?${qs.toString()}`);
      setItems(r.data.items); setStats(r.data.stats); setQueueFailed(false);
    } catch { setQueueFailed(true); }
  }, [status, search]);

  useEffect(() => { loadQueue(); const t = setInterval(loadQueue, 8000); return () => clearInterval(t); }, [loadQueue]);

  const openDetail = async (id: string) => {
    if (!canProcess) return;
    try {
      const r = await apiClient.get<{ data: Detail }>(`/api/v1/staff/document-requests/${id}`);
      setSel(r.data);
      setRecTypes(r.data.request.recordTypes ?? Object.keys(r.data.available).filter((k) => (r.data.available[k] ?? 0) !== 0 && k !== 'PRESCRIPTION'));
      setRejectMode(null);
      setDraftInfo(null);
      if (BGROUP.includes(r.data.request.type)) {
        const authored = r.data.request.artifacts?.[0]?.authoredJson;
        if (authored) setCert({ ...authored, diagnoses: authored.diagnoses ?? [] });
        else setCert({ diagnoses: [], purpose: r.data.request.purpose });
      }
    } catch { toast.error('상세 조회 실패'); }
  };

  // B그룹: 진료기록 기반 작성 초안 자동 채움
  const loadDraft = async (id: string) => {
    if (!canProcess) return;
    try {
      const r = await apiClient.get<{ data: { encounterId: string | null; isAttending: boolean; draft: CertForm | null; admissions?: AdmissionPick[] } }>(`/api/v1/staff/document-requests/${id}/draft`);
      setDraftInfo({ isAttending: r.data.isAttending, encounterId: r.data.encounterId, admissions: r.data.admissions });
      if (r.data.draft) setCert({ ...r.data.draft, encounterId: r.data.encounterId ?? undefined, diagnoses: r.data.draft.diagnoses ?? [] });
      else toast.info('자동 채울 진료기록이 없습니다. 직접 입력하세요.');
    } catch { toast.error('초안 로드 실패'); }
  };

  const authorCert = async (id: string) => {
    if (!canProcess) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/staff/document-requests/${id}/author`, { ...cert, encounterId: cert.encounterId ?? draftInfo?.encounterId });
      toast.success('작성 저장됨 — 전자서명 후 발급');
      await openDetail(id); await loadQueue();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '작성 실패'); }
    finally { setBusy(false); }
  };

  const signCert = async (id: string) => {
    if (!canProcess) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/staff/document-requests/${id}/sign`, {});
      toast.success('전자서명 완료 — 발급 가능');
      await openDetail(id); await loadQueue();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '서명 실패'); }
    finally { setBusy(false); }
  };

  const snapshot = async () => {
    if (!canProcess) return;
    if (!sel || !recTypes.length) { toast.error('기록 유형을 선택하세요'); return; }
    setBusy(true);
    try {
      const r = await apiClient.post<{ data: { artifacts: { recordType: string; count: number }[] } }>(`/api/v1/staff/document-requests/${sel.request.id}/snapshot`, {
        recordTypes: recTypes, periodFrom: sel.request.periodFrom, periodTo: sel.request.periodTo,
      });
      const total = r.data.artifacts.reduce((a, b) => a + b.count, 0);
      toast.success(`스냅샷 동결 — ${total}건`);
      await openDetail(sel.request.id); await loadQueue();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '스냅샷 실패'); }
    finally { setBusy(false); }
  };

  const issue = async () => {
    if (!canProcess) return;
    if (!sel) return;
    setBusy(true);
    try {
      const r = await apiClient.post<{ data: { issueNo: string; feeBilling?: { attempted: boolean; result: string } } }>(`/api/v1/staff/document-requests/${sel.request.id}/issue`, {});
      toast.success(`발급 완료 — ${r.data.issueNo}`);
      // 수납 연결을 시도했는데 올리지 못했으면 그 자리에서 말한다(발급은 끝났다 — 상세의 수납 연결 칸에서 다시 올릴 수 있다)
      const fb = r.data.feeBilling;
      if (fb?.attempted && fb.result !== 'ADDED' && fb.result !== 'ALREADY') toast.warning(tAttr('발급은 끝났지만 수수료를 수납에 올리지 못했습니다'));
      await openDetail(sel.request.id); await loadQueue();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '발급 실패'); }
    finally { setBusy(false); }
  };

  const deliver = async () => {
    if (!canProcess) return;
    if (!sel) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/staff/document-requests/${sel.request.id}/deliver`, { ref: deliverRef || undefined });
      toast.success('수령 완료 처리됨'); setDeliverRef('');
      await openDetail(sel.request.id); await loadQueue();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '수령 처리 실패'); }
    finally { setBusy(false); }
  };

  const loadReport = async () => {
    if (!canProcess) return;
    setShowReport((v) => !v);
    if (report) return;
    try {
      const r = await apiClient.get<{ data: Report }>('/api/v1/staff/document-requests/report');
      setReport(r.data);
    } catch (e) { toast.error((e as { message?: string })?.message ?? '리포트 조회 실패'); }
  };

  const reject = async () => {
    if (!canProcess) return;
    if (!sel || !rejectMode) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/staff/document-requests/${sel.request.id}/reject`, rejectMode);
      toast.success('반려 처리됨'); setSel(null); setRejectMode(null); await loadQueue();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '반려 실패'); }
    finally { setBusy(false); }
  };

  const r = sel?.request;
  const isB = !!r && BGROUP.includes(r.type);
  const art = sel?.request.artifacts?.[0];
  const canSnapshot = r && !isB && (r.status === 'REQUESTED' || r.status === 'IN_REVIEW');
  const canIssue = r && !r.issuedDocumentId && (
    isB ? !!art?.signedAt : (r.status === 'IN_REVIEW' && (sel?.request.artifacts?.length ?? 0) > 0)
  );
  const setDx = (i: number, k: 'name' | 'kcdCode', v: string) => setCert((c) => ({ ...c, diagnoses: c.diagnoses.map((d, j) => j === i ? { ...d, [k]: v } : d) }));

  return (
    <div className="max-w-6xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1"><T k="서류 발급 워크스테이션" /></h2>
      <p className="text-sm text-gray-500 mb-4"><T k="환자 의무기록 사본 요청을 검토·동결·발급합니다(의료법 §21)." /></p>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        {['REQUESTED', 'IN_REVIEW', 'READY', 'DELIVERED', 'REJECTED'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm border ${status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}`}>
            <T k={STATUS_LABEL[s]} /> {stats[s] ? `(${stats[s]})` : ''}
          </button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tAttr('환자 이름·등록번호·접수번호')} aria-label={tAttr('요청 찾기')} data-doc-queue-search
          className="ml-auto min-h-[36px] w-52 rounded-lg border px-2 text-sm" />
        <button onClick={() => setShowLedger((v) => !v)} aria-pressed={showLedger} data-doc-ledger-toggle className={`px-3 py-1.5 rounded-lg text-sm border ${showLedger ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-200'}`}>📒 <T k="발급 대장" /></button>
        <button onClick={loadReport} className={`px-3 py-1.5 rounded-lg text-sm border ${showReport ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-200'}`}>📊 <T k="발급 리포트" /></button>
      </div>

      {showLedger && <LedgerPanel typeLabel={TYPE_LABEL} />}

      {showReport && (
        <div className="bg-white rounded-xl border p-4 mb-3">
          {!report ? <div className="text-sm text-gray-400"><T k="불러오는 중…" /></div> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
                {[['신청', report.totals.requested], ['발급', report.totals.issued], ['교부', report.totals.delivered], ['반려', report.totals.rejected], ['수수료 합계', `${money(report.totals.feeSum)}`]].map(([l, v]) => (
                  <div key={l as string} className="bg-gray-50 rounded-lg p-2"><div className="text-[11px] text-gray-400"><T k={l as string} /></div><div className="text-sm font-bold text-gray-800">{v}</div></div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div><div className="font-semibold text-gray-600 mb-1"><T k="유형별" /></div>{report.byType.length === 0 ? <span className="text-gray-400"><T k="없음" /></span> : report.byType.map((t) => <div key={t.type} className="flex justify-between text-gray-600"><span><T k={TYPE_LABEL[t.type] ?? t.type} /></span><span>{t.count}<Unit>건</Unit> · <Money value={t.feeSum} /></span></div>)}</div>
                <div><div className="font-semibold text-gray-600 mb-1"><T k="수령방법" /></div>{Object.keys(report.byDelivery).length === 0 ? <span className="text-gray-400"><T k="없음" /></span> : Object.entries(report.byDelivery).map(([k, v]) => <div key={k} className="flex justify-between text-gray-600"><span><T k={DELIVERY_LABEL[k] ?? k} /></span><span>{v}<Unit>건</Unit></span></div>)}</div>
                <div><div className="font-semibold text-gray-600 mb-1"><T k="처리 성과" /></div><div className="flex justify-between text-gray-600"><span><T k="평균 처리시간" /></span><span>{report.processing.avgHours != null ? `${report.processing.avgHours}시간` : '—'}</span></div><div className="flex justify-between text-gray-600"><span><T k="SLA 위반" /></span><span className={report.processing.slaBreaches > 0 ? 'text-red-600 font-semibold' : ''}>{report.processing.slaBreaches}<Unit>건</Unit></span></div>{report.sample?.truncated && <p className="mt-1 text-[11px] text-amber-700" data-doc-report-truncated><Tf k="발급 {total}건 중 {counted}건만 셌습니다(처리 시간·수령 방법·수수료 합)" params={{ total: report.sample.total, counted: report.sample.counted }} /></p>}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 큐 */}
        <div className="bg-white rounded-xl border divide-y">
          {queueFailed && <div className="p-4 text-sm font-semibold text-rose-700" data-doc-queue-failed><T k="요청 목록을 불러오지 못했습니다 — 0건이 아닙니다" /></div>}
          {!queueFailed && items.length === 0 && <div className="p-6 text-sm text-gray-400"><T k="해당 상태의 요청이 없습니다." /></div>}
          {items.map((it) => (
            <button key={it.id} onClick={() => openDetail(it.id)} className={`w-full text-left p-3 hover:bg-gray-50 ${sel?.request.id === it.id ? 'bg-blue-50' : ''}`}>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-900">{it.patient.name} <span className="text-gray-400 font-normal">{it.patient.mrn}</span></span>
                <StatusBadge domain="docIssuance" status={it.status} className="text-[11px]" />
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{it.receiptNumber && <span className="font-mono">{it.receiptNumber} · </span>}{it.purpose || <T k="목적 미기재" />} · {it.copies}부 · <Money value={it.fee} />{it.deliveryMethod && <> · <T k={DELIVERY_LABEL[it.deliveryMethod] ?? it.deliveryMethod} /></>}</div>
              {it.feeBilling && it.feeBilling.state !== 'OFF' && <div className="mt-0.5"><FeeBillingBadge value={it.feeBilling} /></div>}
            </button>
          ))}
        </div>

        {/* 상세 */}
        <div className="bg-white rounded-xl border p-4">
          {!r && <div className="text-sm text-gray-400"><T k="좌측에서 요청을 선택하세요." /></div>}
          {r && (
            <>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-base font-bold text-gray-900">{r.patient.name} <span className="text-sm text-gray-400">{r.patient.mrn}</span></div>
                  <div className="text-xs text-gray-500"><T k={STATUS_LABEL[r.status]} /> · {r.copies}부 · <T k="수령" /> <T k={DELIVERY_LABEL[r.deliveryMethod] ?? r.deliveryMethod} />{r.deliveryDestination && <span data-doc-destination> · {r.deliveryDestination}</span>}</div>
                </div>
                {r.issuedDocumentId && <span className="text-[11px] font-mono text-emerald-600">{r.issuedDocumentId}</span>}
              </div>
              <StageStrip r={r} isCertificate={isB} />
              {r.legalBasis && r.legalBasis !== 'SELF' && (
                <p className={`mb-2 rounded-lg px-3 py-1.5 text-xs ${r.proxyVerifyStatus === 'VERIFIED' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`} data-doc-proxy={r.proxyVerifyStatus ?? 'NONE'}>
                  <T k="대리 신청" />{r.requesterRelation ? ` (${r.requesterRelation})` : ''} · {r.proxyVerifyStatus === 'VERIFIED' ? <T k="창구 대면 확인 기록 있음(서류 진위는 시스템이 검증하지 않음)" /> : <T k="대면 확인 기록 없음 — 발급 전에 신청인 자격을 확인하십시오" />}
                </p>
              )}
              {r.status === 'REJECTED' && r.rejectReason && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-800" data-doc-reject-reason><T k="반려 사유" />: {r.rejectReason}</p>}
              <div className="text-sm text-gray-600 mb-2"><T k={TYPE_LABEL[r.type] ?? r.type} /> · <T k="목적" />: {r.purpose || '-'}{!isB && ` / 기간: ${r.periodFrom?.slice(0, 10) ?? '전체'} ~ ${r.periodTo?.slice(0, 10) ?? ''}`}</div>

              {/* 수수료 — 발급 후엔 확정 fee, 그 전엔 견적 */}
              {(r.fee != null || sel?.estimatedFee) && (
                <div className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3 flex items-center justify-between">
                  <span className="text-amber-800">
                    <T k={r.issuedDocumentId ? '발급 수수료' : '예상 수수료'} /> <b className="text-sm"><Money value={(r.fee ?? sel?.estimatedFee?.total ?? 0)} /></b>
                    {sel?.estimatedFee && !r.issuedDocumentId && <span className="text-gray-400"> ({sel.estimatedFee.pages > 0 ? `${sel.estimatedFee.pages}매 · ` : ''}{sel.estimatedFee.copies}부{sel.estimatedFee.ruleSource === 'DEFAULT' ? ' · 기본요율' : ' · 기관요율'})</span>}
                  </span>
                  <span data-doc-fee-billing-detail><FeeBillingBadge value={sel?.feeBilling} requestId={r.id} canRetry={canProcess} onChanged={() => { void openDetail(r.id); void loadQueue(); }} /></span>
                </div>
              )}

              {/* B그룹: 진단서·소견서·입퇴원확인서 작성·서명 */}
              {isB && !r.issuedDocumentId && (
                <div className="border rounded-lg p-3 mb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700"><T k="증명서 작성" /> {art?.signedAt && <span className="text-emerald-600">· <T k="서명완료" /></span>}</span>
                    <button onClick={() => loadDraft(r.id)} disabled={busy || !!art?.signedAt} className="text-xs px-2 py-1 border rounded-lg text-gray-600 disabled:opacity-50"><T k="진료기록 자동채움" /></button>
                  </div>
                  {/* 🔴 (B7) 입퇴원확인서 — 입원을 고른다(입원·퇴원 일자는 서버가 원장에서 싣는다) · 미선택으로 시작 */}
                  {r.type === 'ADMISSION_CERT' && (
                    <div data-admission-pick>
                      <span className="text-[11px] text-gray-400"><T k="대상 입원" /></span>
                      {draftInfo?.admissions === undefined ? (
                        <p className="text-[11px] text-gray-500"><T k="진료기록 자동채움을 누르면 이 환자의 입원 목록을 불러옵니다." /></p>
                      ) : draftInfo.admissions.length === 0 ? (
                        <p className="text-[11px] text-red-500"><T k="이 환자의 입원 기록이 없습니다 — 입퇴원확인서를 만들 수 없습니다." /></p>
                      ) : (
                        <select value={cert.admissionId ?? ''} onChange={(e) => setCert((c) => ({ ...c, admissionId: e.target.value || undefined }))} disabled={!!art?.signedAt} className="w-full px-2 py-1 border rounded text-xs">
                          <option value="">{tAttr('입원 선택')}</option>
                          {draftInfo.admissions.map((a) => (
                            <option key={a.id} value={a.id}>{fmtDate(a.admitDate)} ~ {a.dischargeDate ? fmtDate(a.dischargeDate) : tAttr('재원 중')}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {draftInfo && draftInfo.isAttending === false && r.type === 'DIAGNOSIS_CERT' && (
                    <p className="text-[11px] text-red-500">⚠️ <T k="직접 진찰한 담당의가 아닙니다. 진단서는 담당의만 작성·서명할 수 있습니다(의료법 §17)." /></p>
                  )}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between"><span className="text-[11px] text-gray-400"><T k="진단" /></span>
                      <button onClick={() => setCert((c) => ({ ...c, diagnoses: [...c.diagnoses, {}] }))} disabled={!!art?.signedAt} className="text-[11px] text-blue-600 disabled:opacity-50">+ <T k="추가" /></button></div>
                    {cert.diagnoses.map((d, i) => (
                      <div key={i} className="flex gap-1">
                        <input value={d.name ?? ''} onChange={(e) => setDx(i, 'name', e.target.value)} disabled={!!art?.signedAt} placeholder={tAttr('진단명')} className="flex-1 px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                        <input value={d.kcdCode ?? ''} onChange={(e) => setDx(i, 'kcdCode', e.target.value)} disabled={!!art?.signedAt} placeholder="KCD" className="w-24 px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={cert.onsetDate?.slice(0, 10) ?? ''} onChange={(e) => setCert((c) => ({ ...c, onsetDate: e.target.value }))} disabled={!!art?.signedAt} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                    <input value={cert.purpose ?? ''} onChange={(e) => setCert((c) => ({ ...c, purpose: e.target.value }))} disabled={!!art?.signedAt} placeholder={tAttr('용도')} className="px-2 py-1 border rounded text-xs disabled:bg-gray-50" />
                  </div>
                  <textarea value={cert.treatmentOpinion ?? ''} onChange={(e) => setCert((c) => ({ ...c, treatmentOpinion: e.target.value }))} disabled={!!art?.signedAt} placeholder={tAttr('향후 치료 의견')} rows={2} className="w-full px-2 py-1 border rounded text-xs resize-none disabled:bg-gray-50" />
                  {/* 서명 전 미리보기(2026-10-10) — 서명하는 것은 **저장된 작성본**이다(입력 중인 칸이 아니다) · 저장 뒤 고친 칸이 있으면 다시 저장해야 서명본이 바뀐다 */}
                  {art?.authoredJson && !art?.signedAt && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-2 text-xs text-gray-700" data-doc-cert-preview>
                      <p className="mb-1 font-semibold text-indigo-900"><T k="서명할 작성본(저장된 내용)" /></p>
                      <p><T k="진단" />: {(art.authoredJson.diagnoses ?? []).filter((d) => d.name || d.kcdCode).map((d) => `${d.name ?? ''}${d.kcdCode ? ` (${d.kcdCode})` : ''}`).join(', ') || '—'}</p>
                      <p><T k="발병일" />: {art.authoredJson.onsetDate?.slice(0, 10) || '—'} · <T k="용도" />: {art.authoredJson.purpose || '—'}</p>
                      <p className="whitespace-pre-wrap"><T k="향후 치료 의견" />: {art.authoredJson.treatmentOpinion || '—'}</p>
                      {certDiffers(cert, art.authoredJson) && (
                        <p className="mt-1 font-semibold text-amber-800" data-doc-cert-unsaved><T k="입력 칸이 저장된 작성본과 다릅니다 — '작성 저장' 후 서명하십시오" /></p>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {canAuthor && !art?.signedAt && <button onClick={() => authorCert(r.id)} disabled={busy} className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm disabled:opacity-50"><T k="작성 저장" /></button>}
                    {canAuthor && !art?.signedAt && art?.authoredJson && <button onClick={() => signCert(r.id)} disabled={busy || certDiffers(cert, art.authoredJson)} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"><T k="전자서명" /></button>}
                  </div>
                </div>
              )}

              {canSnapshot && (
                <div className="border rounded-lg p-3 mb-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2"><T k="발급 기록 범위" /></div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {REC_TYPES.map(([k, lbl]) => {
                      const avail = sel!.available[k];
                      const on = recTypes.includes(k);
                      return (
                        <button key={k} onClick={() => setRecTypes((p) => on ? p.filter((x) => x !== k) : [...p, k])}
                          className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                          <T k={lbl} />{avail != null && avail >= 0 ? ` ${avail}` : ''}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={snapshot} disabled={busy} className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm disabled:opacity-50"><T k="스냅샷 동결" /></button>
                </div>
              )}

              {!isB && (sel?.request.artifacts?.length ?? 0) > 0 && (
                <div className="text-xs text-gray-600 mb-3"><T k="동결됨" />: {sel!.request.artifacts.map((a) => `${REC_TYPES.find((t) => t[0] === a.recordType)?.[1] ?? a.recordType}`).join(', ')}</div>
              )}

              <div className="flex gap-2">
                {canIssue && <button onClick={issue} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"><T k="발급" /></button>}
                {r.status !== 'READY' && r.status !== 'DELIVERED' && r.status !== 'REJECTED' && (
                  <button onClick={() => setRejectMode({ reason: 'NO_RECORD', detail: '' })} className="px-4 py-2 border text-gray-600 rounded-lg text-sm"><T k="반려@행위" /></button>
                )}
              </div>

              {/* P3 수령 처리 — 발급완료(READY)면 수령 입력, 교부완료(DELIVERED)면 결과 표시 */}
              {r.issuedDocumentId && r.status === 'READY' && (
                <div className="border rounded-lg p-3 mt-3 bg-emerald-50/40">
                  <div className="text-xs font-semibold text-gray-700 mb-2"><T k="수령 처리" /> — {DELIVERY_LABEL[r.deliveryMethod] ? <T k={DELIVERY_LABEL[r.deliveryMethod]} /> : r.deliveryMethod}{(r.deliveryMethod === 'MAIL' || r.deliveryMethod === 'FAX') && <span className="text-red-500"> *<T k="번호 필수" /></span>}</div>
                  <div className="flex gap-2">
                    {r.deliveryMethod !== 'VISIT' && (
                      <input value={deliverRef} maxLength={120} onChange={(e) => setDeliverRef(e.target.value)} placeholder={tAttr(r.deliveryMethod === 'MAIL' ? '등기 송장번호' : '팩스 수신번호')} className="flex-1 px-2 py-1.5 border rounded-lg text-sm" />
                    )}
                    {r.deliveryMethod === 'VISIT' && (
                      <input value={deliverRef} maxLength={120} onChange={(e) => setDeliverRef(e.target.value)} placeholder={tAttr('수령인 확인 메모(선택)')} className="flex-1 px-2 py-1.5 border rounded-lg text-sm" />
                    )}
                    <button onClick={deliver} disabled={busy} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm disabled:opacity-50 whitespace-nowrap"><T k="수령 완료" /></button>
                  </div>
                </div>
              )}
              {r.status === 'DELIVERED' && (
                <div className="text-xs text-emerald-700 mt-3">✓ <T k="교부완료" /> — {DELIVERY_LABEL[r.deliveryMethod] ? <T k={DELIVERY_LABEL[r.deliveryMethod]} /> : r.deliveryMethod}{r.deliveryRef ? ` · ${r.deliveryRef}` : ''}{r.deliveredAt ? ` · ${r.deliveredAt.slice(0, 10)}` : ''}</div>
              )}

              {rejectMode && (
                <div className="border rounded-lg p-3 mt-3">
                  <select value={rejectMode.reason} onChange={(e) => setRejectMode({ ...rejectMode, reason: e.target.value })} className="px-2 py-1.5 border rounded-lg text-sm w-full mb-2">
                    {REJECT_REASONS.map(([k, lbl]) => <option key={k} value={k}>{tAttr(lbl)}</option>)}
                  </select>
                  <ReasonInput domain="documentReject" maxLength={250} value={rejectMode.detail} onChange={(v) => setRejectMode({ ...rejectMode, detail: v })} placeholder={tAttr('상세 사유(선택)')} className="px-2 py-1.5 border rounded-lg text-sm w-full mb-2" />
                  <div className="flex gap-2">
                    <button onClick={reject} disabled={busy} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm disabled:opacity-50"><T k="반려 확정" /></button>
                    <button onClick={() => setRejectMode(null)} className="px-3 py-1.5 border rounded-lg text-sm text-gray-500"><T k="취소" /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 단계 띠 — 접수 → 작성·동결 → 발급 → 수령 · 원장 사실로 판정(issuance-stages) */
function StageStrip({ r, isCertificate }: { r: Detail['request']; isCertificate: boolean }) {
  const { stages, rejected } = issuanceStages({ status: r.status, issuedDocumentId: r.issuedDocumentId, deliveredAt: r.deliveredAt, artifacts: r.artifacts, isCertificate });
  const tone = { DONE: 'bg-emerald-600 text-white', CURRENT: 'bg-blue-600 text-white ring-2 ring-blue-200', TODO: 'bg-gray-100 text-gray-500', STOPPED: 'bg-rose-100 text-rose-700' } as const;
  return (
    <ol className="mb-3 flex flex-wrap items-center gap-1 text-[11px]" data-doc-stages aria-label="처리 단계">
      {stages.map((st, i) => (
        <li key={st.key} className="flex items-center gap-1" data-doc-stage={st.key} data-state={st.state}>
          {i > 0 && <span className="text-gray-300">→</span>}
          <span className={`rounded-full px-2 py-0.5 font-semibold ${tone[st.state]}`}><T k={st.label} /></span>
        </li>
      ))}
      {rejected && <li className="ml-1 rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white" data-doc-stage="REJECTED"><T k="반려" /></li>}
    </ol>
  );
}

/** 입력 칸과 저장된 작성본이 다른가 — 서명은 저장본에 하므로, 다르면 먼저 저장하게 한다(키 순서·빈 칸 차이는 같은 것으로) */
function certDiffers(a: CertForm, b: CertForm): boolean {
  const norm = (c: CertForm) => JSON.stringify({
    diagnoses: (c.diagnoses ?? []).map((d) => ({ name: (d.name ?? '').trim(), kcdCode: (d.kcdCode ?? '').trim() })).filter((d) => d.name || d.kcdCode),
    onsetDate: (c.onsetDate ?? '').slice(0, 10), purpose: (c.purpose ?? '').trim(), treatmentOpinion: (c.treatmentOpinion ?? '').trim(),
  });
  return norm(a) !== norm(b);
}
