'use client';

/**
 * 마약류 관리(마약류관리법) — 화면 실사용 점검 W8(2026-08-14) 전면 봉합.
 *
 * 이 화면이 종전에 **사실이 아닌 것을 말하던 자리**:
 *  - P11 계약 불일치: `/logs` 응답은 `{ items, total, page, limit }` 봉투인데 배열로 읽어
 *    목록이 **항상 비었고**, 그 빈 배열로 "미확인 0 · 오늘 처방 0 · 전체 기록 0 · 폐기 0" 을 단정했다.
 *  - P11: 로그의 등급 필드는 `deaSchedule` 인데 `schedule` 을 읽어 등급 배지가 전부 회색 `undefined류`.
 *  - P11: 폐기 모달이 증인을 **성명 문자열**(`witness`)로 보냈다 — 서버는 `witnessId`(User.id)를 읽는다.
 *    → 개통 이래 폐기 기록 100% 실패. 이제 증인은 **사람(User.id) 선택**이다(2인 무결성).
 *  - P16/P17: "NIMS 배치(식약처 제출)" 버튼은 **파일을 만들 뿐 전송하지 않는다**.
 *    이제 전송 여부를 건별로 말하고(전송 근거 없음/원내 기록/수기 접수), 수기 접수번호를 기록한다.
 *  - P1: 일일 원장 잔량이 폐기량 미기재 건을 0 으로 삼켜 계산됐다 → 서버가 `null`(산출 불가)로 준다.
 *  - 배선 없음: 재고 수불부·실사 불일치(유용 의심)·사고마약류(§12) 엔드포인트를 **부르는 화면이 없었다**.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import StatusBadge from '@/components/ui/StatusBadge';
import { KDate, EmptyState, PatientName, StaffName, Unknown, UnitText } from '@/components/ui/display';
import { pollMs } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ── 서버 계약(그대로 옮긴 것 — 추측 금지) ─────────────────────────────────── */

interface StaffBrief { id: string; familyName: string; givenName: string; role?: string; department?: string | null }

interface ControlledLog {
  id: string;
  status: string;
  drugName: string;
  drugCode?: string | null;
  /** 🔴 `schedule` 이 아니다 — 서버 컬럼은 deaSchedule */
  deaSchedule: string;
  narcoticType?: string | null;
  quantity: number | string;
  administeredQty?: number | string | null;
  wastedQty?: number | string | null;
  unit: string;
  prescribedAt: string;
  verifiedAt?: string | null;
  dispensedAt?: string | null;
  administeredAt?: string | null;
  wasteReason?: string | null;
  patient?: { id: string; familyName: string; givenName: string; mrn: string } | null;
  prescriber?: StaffBrief | null;
  verifier?: StaffBrief | null;
  dispenser?: StaffBrief | null;
  administrator?: StaffBrief | null;
  witness?: StaffBrief | null;
}

interface LogsEnvelope { items: ControlledLog[]; total: number; page: number; limit: number }

interface DailyLedgerRow {
  drugName: string; schedule: string; narcoticType: string | null; unit: string;
  prescribed: number; dispensed: number; administered: number; wasted: number;
  /** 폐기량 미기재가 섞이면 null = 산출 불가(0 이 아니다) */
  remaining: number | null;
  count: number; assumedFullDose: number; wastedQtyUnknown: number; notes: string[];
}
interface DailyLedger { date: string; rows: DailyLedgerRow[]; wasteDateBasis: string }

interface NimsChannelNotice { channel: string; implemented: boolean; manualFallback: string }
interface NimsTransmission { state: string; transmitted: boolean; label: string; note: string; channel: string }
interface NimsReport {
  id: string; reportType: string; status: string; drugName: string; drugCode?: string | null;
  narcoticType?: string | null; quantity: number | string; unit: string; eventAt: string;
  submittedAt?: string | null; nimsRefNo?: string | null; errorMessage?: string | null;
  transmission: NimsTransmission;
}
interface NimsQueue extends NimsChannelNotice {
  items: NimsReport[];
  counts: { total: number; transmitted: number; notTransmitted: number };
}

interface Incident {
  id: string; incidentType: string; status: string; drugName: string; drugCode?: string | null;
  quantity: number | string; unit: string; occurredAt: string; description: string;
  filedAt?: string | null; reportedBy: string; reporter?: StaffBrief | null;
}

interface Stock {
  id: string; drugCode: string; drugName: string; deaSchedule: string; unit: string;
  location: string; balance: number | string; lastCountedAt?: string | null;
}
interface StockTxn {
  id: string; stockId: string; type: string; quantity: number | string;
  balanceBefore: number | string; balanceAfter: number | string;
  reason?: string | null; discrepancy?: number | string | null; occurredAt: string;
  performer?: StaffBrief | null; witness?: StaffBrief | null;
  stock?: { id: string; drugName: string; deaSchedule: string; location: string; unit: string } | null;
}

interface ControlledStats {
  bySchedule: Record<string, number>;
  byStatus: Record<string, number>;
  total: number;
  todayPrescribed: number;
  pendingVerification: number;
  wasteCount: number;
  nims: { total: number; notTransmitted: number } & NimsChannelNotice;
  discrepancyCount: number;
  openIncidents: number;
}

type CSTab = 'pending' | 'ledger' | 'daily' | 'stock' | 'nims' | 'incidents' | 'stats';

const API = '/api/v1/controlled-substance';

/**
 * 마약류 취급 상태 어휘 — shared 상태 정본(STATUS_LABEL 레지스트리)에 마약류 도메인이 아직 없다.
 * 로컬 배지를 새로 그리는 대신 `<StatusBadge config>` 로 주입해 표기 규약(모양·크기)은 정본을 따른다.
 */
const CS_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PRESCRIBED: { label: '처방', bg: 'bg-amber-100', text: 'text-amber-700' },
  VERIFIED: { label: '2차확인', bg: 'bg-violet-100', text: 'text-violet-700' },
  DISPENSED: { label: '불출', bg: 'bg-blue-100', text: 'text-blue-700' },
  ADMINISTERED: { label: '투약', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  WASTED: { label: '폐기', bg: 'bg-red-100', text: 'text-red-700' },
  RETURNED: { label: '반납', bg: 'bg-gray-100', text: 'text-gray-600' },
};

const NIMS_STATE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  QUEUED: { label: '제출대기', bg: 'bg-amber-100', text: 'text-amber-700' },
  LOCAL_ONLY: { label: '원내 기록(미전송)', bg: 'bg-orange-100', text: 'text-orange-700' },
  SEND_FAILED: { label: '전송 실패', bg: 'bg-red-100', text: 'text-red-700' },
  UNVERIFIED: { label: '전송 근거 없음', bg: 'bg-red-100', text: 'text-red-700' },
  MANUAL_ACK: { label: '수기 접수(NIMS 웹)', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  SENT: { label: '제출 완료', bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

const INCIDENT_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  REPORTED: { label: '원내 보고', bg: 'bg-amber-100', text: 'text-amber-700' },
  FILED: { label: '관할 신고 기록', bg: 'bg-blue-100', text: 'text-blue-700' },
  CLOSED: { label: '종결@상태', bg: 'bg-gray-100', text: 'text-gray-600' },
};

const INCIDENT_TYPE_LABEL: Record<string, string> = { THEFT: '도난', LOSS: '분실@사고유형', DAMAGE: '파손', DISASTER: '재해' };
const TXN_TYPE_LABEL: Record<string, string> = { RECEIPT: '입고', ISSUE: '불출', RETURN: '반납', WASTE: '폐기', ADJUST: '조정', COUNT: '실사' };

const SCHEDULE_COLOR: Record<string, string> = {
  I: 'bg-red-600 text-white',
  II: 'bg-red-100 text-red-700',
  III: 'bg-amber-100 text-amber-700',
  IV: 'bg-blue-100 text-blue-700',
  V: 'bg-gray-100 text-gray-600',
};

function ScheduleBadge({ schedule }: { schedule?: string | null }) {
  if (!schedule) return <Unknown kind="UNRECORDED" className="text-[10px]" />;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SCHEDULE_COLOR[schedule] ?? 'bg-gray-100 text-gray-600'}`}>
      {schedule}류
    </span>
  );
}

/** 수량 — 모르는 값은 0 이 아니라 '기록 없음'. 단위는 서버 값 그대로(임의 환산 금지) */
function Qty({ value, unit }: { value: unknown; unit?: string | null }) {
  if (value === null || value === undefined || value === '') return <Unknown kind="UNRECORDED" />;
  const n = Number(value);
  if (!Number.isFinite(n)) return <Unknown kind="UNRECORDED" />;
  return <UnitText text={`${n}${unit ? ` ${unit}` : ''}`} />;
}

function todayKey() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  // 🔴 toISOString().slice(0,10) 은 UTC 라 KST 오전 9시 이전에 '어제' 를 가리킨다.
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 인증 토큰으로 파일 다운로드(Bearer 필요 → <a href> 불가, fetch→blob) */
async function authDownload(path: string, fallbackName: string): Promise<{ count: number; transmitted: boolean } | null> {
  const token = apiClient.getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { toast.error('배치파일 생성 실패'); return null; }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^"]+)"?/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = m ? m[1] : fallbackName; a.click();
  URL.revokeObjectURL(url);
  return {
    count: Number(res.headers.get('X-Nims-Count') ?? 0),
    // 🔴 서버가 계약으로 박아 둔 사실 — 파일 생성은 제출이 아니다.
    transmitted: res.headers.get('X-Nims-Transmitted') === 'true',
  };
}

/* ── 증인 선택(2인 무결성) ────────────────────────────────────────────────────
 * 증인은 성명 문자열이 아니라 **사람(User.id)** 이어야 한다. 서버가 수행자≠증인을 검증한다.
 */
function WitnessSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tAttr = useTAttr();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cs-witness-candidates'],
    queryFn: () => apiClient.get<{ data: StaffBrief[] }>(`${API}/witness-candidates`),
    staleTime: 60_000,
  });
  const list = data?.data ?? [];
  if (isError) return <p className="text-xs text-red-600"><T k="증인 후보를 불러오지 못했습니다 — 폐기를 기록할 수 없습니다" /></p>;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
    >
      <option value="">{isLoading ? tAttr('불러오는 중…') : list.length ? tAttr('입회자를 선택하세요') : tAttr('선택 가능한 입회자가 없습니다')}</option>
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.familyName}{u.givenName}{u.role ? ` · ${u.role}` : ''}{u.department ? ` · ${u.department}` : ''}
        </option>
      ))}
    </select>
  );
}

/* ── 페이지 ──────────────────────────────────────────────────────────────────── */

export default function ControlledSubstancePage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<CSTab>('pending');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [dailyDate, setDailyDate] = useState(todayKey);

  // 폐기 모달
  const [wasteId, setWasteId] = useState<string | null>(null);
  const [wasteReason, setWasteReason] = useState('');
  const [wasteWitnessId, setWasteWitnessId] = useState('');
  const [wasteQty, setWasteQty] = useState('');

  // 실사 모달
  const [countStock, setCountStock] = useState<Stock | null>(null);
  const [countedQty, setCountedQty] = useState('');
  const [countWitnessId, setCountWitnessId] = useState('');
  const [countReason, setCountReason] = useState('');

  // 재고 수불 이력
  const [ledgerStockId, setLedgerStockId] = useState<string | null>(null);

  // NIMS 수기 접수번호
  const [ackTarget, setAckTarget] = useState<{ kind: 'report'; id: string } | { kind: 'batch'; batchNo: string } | null>(null);
  const [ackRef, setAckRef] = useState('');
  const [ackNote, setAckNote] = useState('');

  // 사고 보고 폼
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incident, setIncident] = useState({ incidentType: 'LOSS', drugName: '', drugCode: '', quantity: '', unit: '', occurredAt: todayKey(), description: '' });

  /** 통계는 **서버가 센 값**이다(목록 길이로 만들지 않는다 — 페이지 1장만 받아 오기 때문) */
  const statsQ = useQuery({
    queryKey: ['cs-stats'],
    queryFn: () => apiClient.get<{ data: ControlledStats }>(`${API}/stats`),
    refetchInterval: pollMs('slow'),
  });
  const stats = statsQ.data?.data;

  const logsQ = useQuery({
    queryKey: ['cs-logs', page, statusFilter],
    queryFn: () => apiClient.get<{ data: LogsEnvelope }>(`${API}/logs`, { page, limit: 20, status: statusFilter || undefined }),
    enabled: tab === 'ledger',
    refetchInterval: tab === 'ledger' ? pollMs('fast') : false,
  });
  const logs = logsQ.data?.data;

  const pendingQ = useQuery({
    queryKey: ['cs-unverified'],
    queryFn: () => apiClient.get<{ data: ControlledLog[] }>(`${API}/unverified`),
    enabled: tab === 'pending',
    refetchInterval: tab === 'pending' ? pollMs('fast') : false,
  });
  const pendingLogs = pendingQ.data?.data ?? [];

  const dailyQ = useQuery({
    queryKey: ['cs-daily', dailyDate],
    queryFn: () => apiClient.get<{ data: DailyLedger }>(`${API}/daily-ledger`, { date: dailyDate }),
    enabled: tab === 'daily',
  });
  const daily = dailyQ.data?.data;

  const stocksQ = useQuery({
    queryKey: ['cs-stocks'],
    queryFn: () => apiClient.get<{ data: Stock[] }>(`${API}/stock`),
    enabled: tab === 'stock',
  });
  const discQ = useQuery({
    queryKey: ['cs-discrepancies'],
    queryFn: () => apiClient.get<{ data: StockTxn[] }>(`${API}/stock/discrepancies`),
    enabled: tab === 'stock',
  });
  const stockLedgerQ = useQuery({
    queryKey: ['cs-stock-ledger', ledgerStockId],
    queryFn: () => apiClient.get<{ data: { stock: Stock; txns: StockTxn[] } }>(`${API}/stock/${ledgerStockId}/ledger`),
    enabled: !!ledgerStockId,
  });

  const nimsQ = useQuery({
    queryKey: ['cs-nims'],
    queryFn: () => apiClient.get<{ data: NimsQueue }>(`${API}/nims/queue`),
    enabled: tab === 'nims',
  });
  const nims = nimsQ.data?.data;

  const incidentsQ = useQuery({
    queryKey: ['cs-incidents'],
    queryFn: () => apiClient.get<{ data: Incident[] }>(`${API}/incidents`),
    enabled: tab === 'incidents',
  });
  const incidents = incidentsQ.data?.data ?? [];

  const invalidateAll = () => {
    ['cs-stats', 'cs-logs', 'cs-unverified', 'cs-daily', 'cs-stocks', 'cs-discrepancies', 'cs-stock-ledger', 'cs-nims', 'cs-incidents']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  /** 서버 오류 메시지를 그대로 보여 준다 — "실패" 한마디는 원인을 숨긴다 */
  const errMsg = (e: unknown, fallback: string) => {
    const m = (e as { message?: string })?.message;
    return m && m !== 'Error' ? m : fallback;
  };

  const verifyMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`${API}/${id}/verify`),
    onSuccess: () => { invalidateAll(); toast.success(tAttr('2차 확인 완료')); },
    onError: (e) => toast.error(errMsg(e, tAttr('2차 확인 실패'))),
  });

  const wasteMut = useMutation({
    mutationFn: ({ id, reason, witnessId, wastedQty }: { id: string; reason: string; witnessId: string; wastedQty?: number }) =>
      apiClient.post(`${API}/${id}/waste`, { reason, witnessId, ...(wastedQty != null ? { wastedQty } : {}) }),
    onSuccess: () => {
      invalidateAll();
      toast.success(tAttr('폐기 기록 완료(입회자 서명 대상)'));
      setWasteId(null); setWasteReason(''); setWasteWitnessId(''); setWasteQty('');
    },
    onError: (e) => toast.error(errMsg(e, tAttr('폐기 기록 실패'))),
  });

  const countMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiClient.post<{ data: { mismatch: boolean; discrepancy: number } }>(`${API}/stock/${id}/count`, body),
    onSuccess: (res) => {
      invalidateAll();
      const d = res?.data;
      if (d?.mismatch) toast.error(`${tAttr('실사 불일치')} ${d.discrepancy} — ${tAttr('유용 의심으로 기록되었습니다')}`);
      else toast.success(tAttr('실사 일치 — 장부와 같습니다'));
      setCountStock(null); setCountedQty(''); setCountWitnessId(''); setCountReason('');
    },
    onError: (e) => toast.error(errMsg(e, tAttr('실사 기록 실패'))),
  });

  const submitNimsMut = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: NimsReport }>(`${API}/nims/${id}/submit`),
    onSuccess: (res) => {
      invalidateAll();
      const t = res?.data?.transmission;
      if (t?.transmitted) toast.success(`${tAttr('전송 완료')} — ${t.label}`);
      // 🔴 나가지 않았으면 성공이라고 말하지 않는다.
      else toast.error(t?.note ?? tAttr('전송되지 않았습니다 — 원내 기록으로 남았습니다'));
    },
    onError: (e) => toast.error(errMsg(e, tAttr('전송 시도 실패'))),
  });

  const ackMut = useMutation({
    mutationFn: (body: { nimsRefNo: string; note?: string; batchNo?: string; id?: string }) =>
      body.id
        ? apiClient.post(`${API}/nims/${body.id}/ack`, { nimsRefNo: body.nimsRefNo, note: body.note })
        : apiClient.post(`${API}/nims/ack-batch`, { nimsRefNo: body.nimsRefNo, note: body.note, batchNo: body.batchNo }),
    onSuccess: () => {
      invalidateAll(); toast.success(tAttr('NIMS 접수번호를 기록했습니다'));
      setAckTarget(null); setAckRef(''); setAckNote('');
    },
    onError: (e) => toast.error(errMsg(e, tAttr('접수번호 기록 실패'))),
  });

  const incidentMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post(`${API}/incidents`, body),
    onSuccess: () => {
      invalidateAll(); toast.success(tAttr('사고마약류를 보고했습니다 — 관할 관청 신고는 별도로 수행하십시오'));
      setIncidentOpen(false);
      setIncident({ incidentType: 'LOSS', drugName: '', drugCode: '', quantity: '', unit: '', occurredAt: todayKey(), description: '' });
    },
    onError: (e) => toast.error(errMsg(e, tAttr('사고 보고 실패'))),
  });

  const fileIncidentMut = useMutation({
    mutationFn: ({ id, filedRef }: { id: string; filedRef: string }) => apiClient.post(`${API}/incidents/${id}/file`, { filedRef }),
    onSuccess: () => { invalidateAll(); toast.success(tAttr('관할 신고 사실을 기록했습니다(전송 아님)')); },
    onError: (e) => toast.error(errMsg(e, tAttr('신고 기록 실패'))),
  });

  if (statsQ.isError) return <QueryErrorFallback error={statsQ.error} onRetry={statsQ.refetch} />;

  /** 서버가 세어 주지 못했으면 숫자를 지어내지 않는다 */
  const statNum = (v: number | undefined) =>
    statsQ.isLoading ? <span className="text-gray-300">…</span> : v == null ? <span className="text-base font-medium text-gray-400"><T k="산출 불가" /></span> : v;

  const nimsNotice = nims ?? stats?.nims;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="마약류 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="처방 · 2차확인 · 불출 · 투약 · 폐기(2인) · 재고 수불부 · 사고마약류 · NIMS 취급보고" /></p>
        </div>
      </div>

      {/* 🔴 전송 미구축 사실을 화면 맨 위에서 밝힌다(P16 — 실행하지 않고 성공 상태만 기록하지 않는다) */}
      {nimsNotice && !nimsNotice.implemented && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            {nimsNotice.channel} <T k="전송 연동 미구축 — 이 화면에서 만든 배치파일은" /> <u><T k="전송되지 않습니다" /></u>
          </p>
          <p className="text-xs text-amber-700 mt-1">{nimsNotice.manualFallback}</p>
        </div>
      )}

      {/* Stats — 전부 서버 집계 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs text-red-500 font-medium"><T k="미확인 (2차확인 대기)" /></p>
          <p className="text-3xl font-bold text-red-700 mt-1">{statNum(stats?.pendingVerification)}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-4">
          <p className="text-xs text-emerald-500 font-medium"><T k="오늘 처방" /></p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">{statNum(stats?.todayPrescribed)}</p>
        </div>
        <div className="bg-indigo-50 rounded-xl p-4">
          <p className="text-xs text-indigo-500 font-medium"><T k="전체 기록" /></p>
          <p className="text-3xl font-bold text-indigo-700 mt-1">{statNum(stats?.total)}</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4">
          <p className="text-xs text-amber-500 font-medium"><T k="폐기 건수" /></p>
          <p className="text-3xl font-bold text-amber-700 mt-1">{statNum(stats?.wasteCount)}</p>
        </div>
        <button onClick={() => setTab('stock')} className="bg-rose-50 rounded-xl p-4 text-left hover:bg-rose-100">
          <p className="text-xs text-rose-500 font-medium"><T k="유용 의심(실사 불일치)" /></p>
          <p className="text-3xl font-bold text-rose-700 mt-1">{statNum(stats?.discrepancyCount)}</p>
        </button>
        <button onClick={() => setTab('nims')} className="bg-orange-50 rounded-xl p-4 text-left hover:bg-orange-100">
          <p className="text-xs text-orange-500 font-medium"><T k="NIMS 미전송" /></p>
          <p className="text-3xl font-bold text-orange-700 mt-1">{statNum(stats?.nims?.notTransmitted)}</p>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl w-fit flex-wrap">
        {([
          { key: 'pending' as CSTab, label: '대기 (미확인)', badge: stats?.pendingVerification ? ` ${stats.pendingVerification}` : '' },
          { key: 'ledger' as CSTab, label: '취급 대장', badge: '' },
          { key: 'daily' as CSTab, label: '일일 원장', badge: '' },
          { key: 'stock' as CSTab, label: '재고 수불부', badge: stats?.discrepancyCount ? ` · ${tAttr('의심')} ${stats.discrepancyCount}` : '' },
          { key: 'nims' as CSTab, label: 'NIMS 취급보고', badge: '' },
          { key: 'incidents' as CSTab, label: '사고마약류', badge: stats?.openIncidents ? ` ${stats.openIncidents}` : '' },
          { key: 'stats' as CSTab, label: '통계', badge: '' },
        ]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}><T k={t.label} />{t.badge}</button>
        ))}
      </div>

      {/* ── 폐기 모달(2인 무결성) ── */}
      {wasteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900"><T k="폐기 기록" /></h3>
            <p className="text-xs text-gray-500 mt-1 mb-4"><T k="마약류 폐기는" /> <b><T k="입회자(증인)" /></b> <T k="가 필요하며 수행자와 달라야 합니다." /></p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="폐기 사유" /></label>
                <textarea value={wasteReason} onChange={(e) => setWasteReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" rows={3} placeholder={tAttr('예) 잔량 폐기 · 파손')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="입회자(증인)" /></label>
                <WitnessSelect value={wasteWitnessId} onChange={setWasteWitnessId} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="폐기 잔량" /> <span className="text-gray-400 font-normal"><T k="(앰플 부분사용 — 모르면 비워 두십시오)" /></span></label>
                <input type="number" min="0" step="any" value={wasteQty} onChange={(e) => setWasteQty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('미입력 시 \'기록 없음\'으로 남습니다')} />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    const q = wasteQty.trim() === '' ? undefined : Number(wasteQty);
                    if (q != null && !Number.isFinite(q)) { toast.error(tAttr('폐기 잔량이 숫자가 아닙니다')); return; }
                    wasteMut.mutate({ id: wasteId, reason: wasteReason.trim(), witnessId: wasteWitnessId, wastedQty: q });
                  }}
                  disabled={wasteMut.isPending || !wasteReason.trim() || !wasteWitnessId}
                  className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  <T k={wasteMut.isPending ? '기록 중…' : '폐기 기록'} />
                </button>
                <button onClick={() => { setWasteId(null); setWasteReason(''); setWasteWitnessId(''); setWasteQty(''); }}
                  className="px-4 py-2.5 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 실사 모달 ── */}
      {countStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900"><T k="실사 대사" /> — {countStock.drugName}</h3>
            <p className="text-xs text-gray-500 mt-1 mb-4">
              <T k="장부 잔량" /> <b><Qty value={countStock.balance} unit={countStock.unit} /></b> · {countStock.location}
              <br /><T k="차이가 있으면" /> <b><T k="증인이 필요" /></b><T k="하며 유용 의심으로 기록됩니다." />
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="실사 수량" /></label>
                <input type="number" min="0" step="any" value={countedQty} onChange={(e) => setCountedQty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('금고에서 실제로 센 수량')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="증인" /> <span className="text-gray-400 font-normal"><T k="(불일치 시 필수)" /></span></label>
                <WitnessSelect value={countWitnessId} onChange={setCountWitnessId} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><T k="비고" /></label>
                <input value={countReason} onChange={(e) => setCountReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('예) 정기 실사')} />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    const q = Number(countedQty);
                    if (countedQty.trim() === '' || !Number.isFinite(q)) { toast.error(tAttr('실사 수량을 입력하십시오')); return; }
                    countMut.mutate({ id: countStock.id, body: { countedQty: q, witnessedBy: countWitnessId || undefined, reason: countReason.trim() || undefined } });
                  }}
                  disabled={countMut.isPending || countedQty.trim() === ''}
                  className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  <T k={countMut.isPending ? '기록 중…' : '실사 기록'} />
                </button>
                <button onClick={() => { setCountStock(null); setCountedQty(''); setCountWitnessId(''); setCountReason(''); }}
                  className="px-4 py-2.5 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NIMS 수기 접수번호 모달 ── */}
      {ackTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900"><T k="NIMS 수기 접수번호 기록" /></h3>
            <p className="text-xs text-gray-500 mt-1 mb-4">
              <T k="NIMS 웹에 배치파일을 올린 뒤" /> <b><T k="식약처가 발급한 접수번호" /></b><T k="를 입력하십시오. 원내 배치번호(" /><code>LOCAL-…</code><T k=")는 접수번호가 아닙니다." />
              {ackTarget.kind === 'batch' && <><br /><T k="대상 배치:" /> <code>{ackTarget.batchNo}</code><T k="(해당 배치 전 건에 기록)" /></>}
            </p>
            <div className="space-y-3">
              <input value={ackRef} onChange={(e) => setAckRef(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('NIMS 접수번호')} />
              <input value={ackNote} onChange={(e) => setAckNote(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('비고(선택)')} />
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => ackMut.mutate({
                    nimsRefNo: ackRef.trim(),
                    note: ackNote.trim() || undefined,
                    ...(ackTarget.kind === 'report' ? { id: ackTarget.id } : { batchNo: ackTarget.batchNo }),
                  })}
                  disabled={ackMut.isPending || !ackRef.trim()}
                  className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  <T k={ackMut.isPending ? '기록 중…' : '접수번호 기록'} />
                </button>
                <button onClick={() => { setAckTarget(null); setAckRef(''); setAckNote(''); }}
                  className="px-4 py-2.5 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 대기(미확인) ── */}
      {tab === 'pending' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['환자', '약물명', '등급', '수량', '처방의', '처방일시', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i === 3 || i === 6 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pendingQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : pendingQ.isError ? (
                <tr><td colSpan={7} className="py-6"><QueryErrorFallback error={pendingQ.error} onRetry={pendingQ.refetch} /></td></tr>
              ) : pendingLogs.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon="✔" title="2차 확인 대기 중인 처방이 없습니다" /></td></tr>
              ) : pendingLogs.map((log) => (
                <tr key={log.id} className="border-b border-gray-50 hover:bg-red-50/30">
                  <td className="px-4 py-3">
                    <PatientName familyName={log.patient?.familyName} givenName={log.patient?.givenName} mrn={log.patient?.mrn} />
                  </td>
                  <td className="px-4 py-3 text-gray-700 font-medium">{log.drugName}</td>
                  <td className="px-4 py-3"><ScheduleBadge schedule={log.deaSchedule} /></td>
                  <td className="px-4 py-3 text-right font-mono text-gray-700"><Qty value={log.quantity} unit={log.unit} /></td>
                  <td className="px-4 py-3 text-gray-600"><StaffName familyName={log.prescriber?.familyName} givenName={log.prescriber?.givenName} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400"><KDate value={log.prescribedAt} mode="datetime" unknown="UNRECORDED" /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => verifyMut.mutate(log.id)} disabled={verifyMut.isPending}
                      className="min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 whitespace-nowrap disabled:opacity-50">
                      <T k="2차 확인" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 취급 대장 ── */}
      {tab === 'ledger' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">{tAttr('전체 상태')}</option>
              {Object.entries(CS_STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{tAttr(v.label)}</option>)}
            </select>
            <span className="text-xs text-gray-500">
              {logs ? <><T k="전체@합계" /> <b>{logs.total}</b>건 · {logs.page} / {Math.max(1, Math.ceil(logs.total / logs.limit))} <T k="페이지" /></> : <T k="집계 중…" />}
            </span>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['환자', '약물', '등급', '수량', '처방', '확인@열', '불출', '투약', '상태', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i === 3 || i === 9 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logsQ.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                  ))
                ) : logsQ.isError ? (
                  <tr><td colSpan={10} className="py-6"><QueryErrorFallback error={logsQ.error} onRetry={logsQ.refetch} /></td></tr>
                ) : !logs?.items.length ? (
                  <tr><td colSpan={10}><EmptyState icon="📋" title="기록이 없습니다" hint={statusFilter ? '다른 상태를 선택해 보십시오' : undefined} /></td></tr>
                ) : logs.items.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <PatientName familyName={log.patient?.familyName} givenName={log.patient?.givenName} mrn={log.patient?.mrn} showMrn={false} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {log.drugName}
                      {log.narcoticType && <span className="ml-1 text-[10px] text-gray-400">{log.narcoticType}</span>}
                    </td>
                    <td className="px-4 py-3"><ScheduleBadge schedule={log.deaSchedule} /></td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700"><Qty value={log.quantity} unit={log.unit} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500"><StaffName familyName={log.prescriber?.familyName} givenName={log.prescriber?.givenName} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500"><StaffName familyName={log.verifier?.familyName} givenName={log.verifier?.givenName} unknown="PENDING" /></td>
                    <td className="px-4 py-3 text-xs text-gray-500"><StaffName familyName={log.dispenser?.familyName} givenName={log.dispenser?.givenName} unknown="PENDING" /></td>
                    <td className="px-4 py-3 text-xs text-gray-500"><StaffName familyName={log.administrator?.familyName} givenName={log.administrator?.givenName} unknown="PENDING" /></td>
                    <td className="px-4 py-3"><StatusBadge status={log.status} config={CS_STATUS_CONFIG} /></td>
                    <td className="px-4 py-3 text-right">
                      {(log.status === 'ADMINISTERED' || log.status === 'DISPENSED' || log.status === 'VERIFIED') && (
                        <button onClick={() => setWasteId(log.id)}
                          className="px-2.5 py-1 text-[10px] font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 whitespace-nowrap"><T k="폐기@마약류" /></button>
                      )}
                      {log.status === 'WASTED' && (
                        <span className="text-[10px] text-gray-400" title={log.wasteReason ?? undefined}>
                          <T k="폐기량" /> <Qty value={log.wastedQty} unit={log.unit} />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!logs?.total && logs.total > logs.limit && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={logs.page <= 1}
                className="px-3 py-1.5 text-xs bg-gray-100 rounded-lg disabled:opacity-40"><T k="이전" /></button>
              <span className="text-xs text-gray-500">{logs.page} / {Math.max(1, Math.ceil(logs.total / logs.limit))}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={logs.page >= Math.ceil(logs.total / logs.limit)}
                className="px-3 py-1.5 text-xs bg-gray-100 rounded-lg disabled:opacity-40"><T k="다음" /></button>
            </div>
          )}
        </div>
      )}

      {/* ── 일일 원장 ── */}
      {tab === 'daily' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-medium text-gray-700"><T k="날짜" /></label>
            <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} max={todayKey()}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            {daily && <span className="text-xs text-gray-400"><T k="기준일" /> {daily.date} · {daily.wasteDateBasis}</span>}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['약물명', '등급', '처방량', '불출량', '투약량', '폐기량', '잔량'].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i >= 2 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyQ.isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ) : dailyQ.isError ? (
                  <tr><td colSpan={7} className="py-6"><QueryErrorFallback error={dailyQ.error} onRetry={dailyQ.refetch} /></td></tr>
                ) : !daily?.rows.length ? (
                  <tr><td colSpan={7}><EmptyState icon="📅" title="해당 날짜에 취급 기록이 없습니다" /></td></tr>
                ) : daily.rows.map((r, idx) => (
                  <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50/50 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.drugName}</p>
                      {r.notes.map((n, i) => <p key={i} className="text-[10px] text-amber-600 mt-0.5">⚠ {n}</p>)}
                    </td>
                    <td className="px-4 py-3"><ScheduleBadge schedule={r.schedule} /></td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700"><Qty value={r.prescribed} unit={r.unit} /></td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700"><Qty value={r.dispensed} unit={r.unit} /></td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700"><Qty value={r.administered} unit={r.unit} /></td>
                    <td className="px-4 py-3 text-right font-mono text-red-600"><Qty value={r.wasted} unit={r.unit} /></td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">
                      {/* 🔴 모르는 잔량을 0 으로 말하지 않는다 */}
                      {r.remaining === null
                        ? <span className="text-xs font-normal text-amber-600" title={tAttr('폐기량 미기재 건이 있어 잔량을 계산할 수 없습니다')}><T k="산출 불가" /></span>
                        : <Qty value={r.remaining} unit={r.unit} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 재고 수불부 · 실사 ── */}
      {tab === 'stock' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900"><T k="금고 장부 잔량" /></p>
              <p className="text-xs text-gray-400"><T k="실사는 장부를 실사값으로 확정하며, 차이는 유용 의심으로 남습니다" /></p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['약품', '등급', '보관장소', '장부 잔량', '최근 실사', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i === 3 || i === 5 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stocksQ.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ) : stocksQ.isError ? (
                  <tr><td colSpan={6} className="py-6"><QueryErrorFallback error={stocksQ.error} onRetry={stocksQ.refetch} /></td></tr>
                ) : !stocksQ.data?.data.length ? (
                  <tr><td colSpan={6}><EmptyState icon="🔐" title="등록된 마약류 재고 항목이 없습니다" hint="입고가 기록되면 여기에 나타납니다" /></td></tr>
                ) : stocksQ.data.data.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{s.drugName}</p>
                      <p className="text-[10px] text-gray-400">{s.drugCode}</p>
                    </td>
                    <td className="px-4 py-3"><ScheduleBadge schedule={s.deaSchedule} /></td>
                    <td className="px-4 py-3 text-gray-600">{s.location}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${Number(s.balance) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      <Qty value={s.balance} unit={s.unit} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500"><KDate value={s.lastCountedAt} mode="datetime" unknown="UNRECORDED" /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setLedgerStockId(ledgerStockId === s.id ? null : s.id)}
                        className="px-2.5 py-1 text-[10px] font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 mr-1">
                        <T k={ledgerStockId === s.id ? '이력 닫기' : '수불 이력'} />
                      </button>
                      <button onClick={() => { setCountStock(s); setCountedQty(''); setCountWitnessId(''); setCountReason(''); }}
                        className="px-2.5 py-1 text-[10px] font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><T k="실사" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ledgerStockId && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">
                  <T k="수불 이력" /> {stockLedgerQ.data?.data.stock ? `— ${stockLedgerQ.data.data.stock.drugName} (${stockLedgerQ.data.data.stock.location})` : ''}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {['일시', '구분', '변동', '전 잔량', '후 잔량', '수행자', '증인', '사유'].map((h, i) => (
                      <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stockLedgerQ.isLoading ? (
                    <tr><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                  ) : stockLedgerQ.isError ? (
                    <tr><td colSpan={8} className="py-6"><QueryErrorFallback error={stockLedgerQ.error} onRetry={stockLedgerQ.refetch} /></td></tr>
                  ) : !stockLedgerQ.data?.data.txns.length ? (
                    <tr><td colSpan={8}><EmptyState icon="📒" title="수불 이력이 없습니다" /></td></tr>
                  ) : stockLedgerQ.data.data.txns.map((t) => (
                    <tr key={t.id} className="border-b border-gray-50">
                      <td className="px-4 py-2 text-xs text-gray-500"><KDate value={t.occurredAt} mode="datetime" /></td>
                      <td className="px-4 py-2 text-xs text-gray-700"><T k={TXN_TYPE_LABEL[t.type] ?? t.type} /></td>
                      <td className={`px-4 py-2 text-right font-mono text-xs ${Number(t.quantity) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{Number(t.quantity) > 0 ? '+' : ''}{Number(t.quantity)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-500">{Number(t.balanceBefore)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-900">{Number(t.balanceAfter)}</td>
                      <td className="px-4 py-2 text-xs"><StaffName familyName={t.performer?.familyName} givenName={t.performer?.givenName} /></td>
                      <td className="px-4 py-2 text-xs"><StaffName familyName={t.witness?.familyName} givenName={t.witness?.givenName} unknown="NA" /></td>
                      <td className="px-4 py-2 text-xs text-gray-500">{t.reason ?? <Unknown kind="UNRECORDED" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-rose-200 shadow-sm overflow-x-auto">
            <div className="px-4 py-3 border-b border-rose-100 bg-rose-50/60">
              <p className="text-sm font-semibold text-rose-800"><T k="유용 의심 — 실사·장부 불일치" /></p>
              <p className="text-xs text-rose-600 mt-0.5"><T k="마약류관리법상 확인·보고 대상입니다. 0 건이라도" /> <b><T k="실사를 한 적이 없으면 안전의 근거가 아닙니다" /></b>.</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['일시', '약품', '장부', '실사', '차이', '수행자', '증인', '사유'].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {discQ.isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ) : discQ.isError ? (
                  <tr><td colSpan={8} className="py-6"><QueryErrorFallback error={discQ.error} onRetry={discQ.refetch} /></td></tr>
                ) : !discQ.data?.data.length ? (
                  <tr><td colSpan={8}><EmptyState icon="🔎" title="기록된 실사 불일치가 없습니다" hint={"실사를 수행한 적이 없으면 '없음'이 아니라 '확인한 적 없음'입니다"} /></td></tr>
                ) : discQ.data.data.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500"><KDate value={t.occurredAt} mode="datetime" /></td>
                    <td className="px-4 py-2 text-xs text-gray-900">{t.stock?.drugName ?? <Unknown kind="UNRECORDED" />}<span className="text-gray-400"> · {t.stock?.location}</span></td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-500">{Number(t.balanceBefore)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-900">{Number(t.balanceAfter)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-bold text-rose-700">{Number(t.discrepancy) > 0 ? '+' : ''}{Number(t.discrepancy)}</td>
                    <td className="px-4 py-2 text-xs"><StaffName familyName={t.performer?.familyName} givenName={t.performer?.givenName} /></td>
                    <td className="px-4 py-2 text-xs"><StaffName familyName={t.witness?.familyName} givenName={t.witness?.givenName} unknown="UNRECORDED" /></td>
                    <td className="px-4 py-2 text-xs text-gray-500">{t.reason ?? <Unknown kind="UNRECORDED" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── NIMS 취급보고 ── */}
      {tab === 'nims' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500"><T k="제출용 배치파일(원내 생성 · 전송 아님):" /></span>
            <button
              onClick={async () => {
                const r = await authDownload(`${API}/nims/export?format=csv`, 'NIMS.csv');
                invalidateAll();
                if (r) toast.success(`${r.count}건 배치파일을 만들었습니다 — ${r.transmitted ? tAttr('전송 완료') : tAttr('아직 전송되지 않았습니다. NIMS 웹 업로드 후 접수번호를 기록하십시오')}`);
              }}
              className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><T k="CSV 생성" /></button>
            <button
              onClick={async () => {
                const r = await authDownload(`${API}/nims/export?format=xml`, 'NIMS.xml');
                invalidateAll();
                if (r) toast.success(`${r.count}건 배치파일을 만들었습니다 — ${r.transmitted ? tAttr('전송 완료') : tAttr('아직 전송되지 않았습니다. NIMS 웹 업로드 후 접수번호를 기록하십시오')}`);
              }}
              className="px-3 py-1.5 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600"><T k="XML 생성" /></button>
            {nims && (
              <span className="text-xs text-gray-500 ml-2">
                <T k="총" /> {nims.counts.total}건 · <T k="도달 근거 있음" /> {nims.counts.transmitted} · <b className="text-orange-700"><T k="미전송" /> {nims.counts.notTransmitted}</b>
              </span>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['취급일시', '구분', '약품', '수량', '전송 상태', '접수번호@신고', '접수시각', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i === 3 || i === 7 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nimsQ.isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ) : nimsQ.isError ? (
                  <tr><td colSpan={8} className="py-6"><QueryErrorFallback error={nimsQ.error} onRetry={nimsQ.refetch} /></td></tr>
                ) : !nims?.items.length ? (
                  <tr><td colSpan={8}><EmptyState icon="📮" title="취급보고 대상이 없습니다" /></td></tr>
                ) : nims.items.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500"><KDate value={r.eventAt} mode="datetime" /></td>
                    <td className="px-4 py-2 text-xs text-gray-700">{r.reportType}</td>
                    <td className="px-4 py-2 text-xs text-gray-900">{r.drugName}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs"><Qty value={r.quantity} unit={r.unit} /></td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.transmission.state} config={NIMS_STATE_CONFIG} className="cursor-help" />
                      <p className="text-[10px] text-gray-400 mt-0.5 max-w-xs">{r.transmission.note}</p>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-600">
                      {r.nimsRefNo
                        ? <span className={r.transmission.transmitted ? '' : 'text-gray-400'}>{r.nimsRefNo}</span>
                        : <Unknown kind="PENDING" />}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500"><KDate value={r.submittedAt} mode="datetime" unknown="PENDING" /></td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {!r.transmission.transmitted && (
                        <>
                          <button onClick={() => submitNimsMut.mutate(r.id)} disabled={submitNimsMut.isPending}
                            className="min-h-[44px] px-3 py-2 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 mr-1 disabled:opacity-50"><T k="전송 시도" /></button>
                          <button onClick={() => { setAckTarget({ kind: 'report', id: r.id }); setAckRef(''); setAckNote(''); }}
                            className="px-2.5 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 mr-1"><T k="접수번호 기록" /></button>
                        </>
                      )}
                      {r.nimsRefNo?.startsWith('LOCAL-NIMS-') && (
                        <button onClick={() => { setAckTarget({ kind: 'batch', batchNo: r.nimsRefNo as string }); setAckRef(''); setAckNote(''); }}
                          className="px-2.5 py-1 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100"><T k="배치 일괄" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 사고마약류(§12) ── */}
      {tab === 'incidents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-gray-500"><T k="도난·분실·파손·재해는" /> <b><T k="지체 없이 관할 관청에 신고" /></b><T k="해야 합니다. 이 화면은 신고를 대신하지 않으며, 신고한 사실을 기록합니다." /></p>
            <button onClick={() => setIncidentOpen((v) => !v)}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700"><T k={incidentOpen ? '닫기' : '사고 보고'} /></button>
          </div>

          {incidentOpen && (
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <select value={incident.incidentType} onChange={(e) => setIncident({ ...incident, incidentType: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                  {Object.entries(INCIDENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
                </select>
                <input value={incident.drugName} onChange={(e) => setIncident({ ...incident, drugName: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('약품명')} />
                <input value={incident.drugCode} onChange={(e) => setIncident({ ...incident, drugCode: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('약품코드(선택)')} />
                <input type="number" min="0" step="any" value={incident.quantity} onChange={(e) => setIncident({ ...incident, quantity: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('수량')} />
                <input value={incident.unit} onChange={(e) => setIncident({ ...incident, unit: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('단위(예: ampule)')} />
                <input type="date" value={incident.occurredAt} max={todayKey()} onChange={(e) => setIncident({ ...incident, occurredAt: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <textarea value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" rows={3} placeholder={tAttr('경위(발견 시각·장소·정황)')} />
              <button
                onClick={() => {
                  const q = Number(incident.quantity);
                  if (!incident.drugName.trim() || !incident.unit.trim() || !incident.description.trim()) { toast.error(tAttr('약품명·단위·경위는 필수입니다')); return; }
                  if (!Number.isFinite(q)) { toast.error(tAttr('수량이 숫자가 아닙니다')); return; }
                  incidentMut.mutate({
                    incidentType: incident.incidentType, drugName: incident.drugName.trim(),
                    drugCode: incident.drugCode.trim() || undefined, quantity: q, unit: incident.unit.trim(),
                    occurredAt: incident.occurredAt, description: incident.description.trim(),
                  });
                }}
                disabled={incidentMut.isPending}
                className="min-h-[44px] px-3 py-2 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                <T k={incidentMut.isPending ? '보고 중…' : '사고 보고'} />
              </button>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['발생일시', '유형', '약품', '수량', '보고자', '상태', '신고 기록', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-xs font-medium text-gray-500 ${i === 3 || i === 7 ? 'text-right' : 'text-left'}`}><T k={h} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incidentsQ.isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ) : incidentsQ.isError ? (
                  <tr><td colSpan={8} className="py-6"><QueryErrorFallback error={incidentsQ.error} onRetry={incidentsQ.refetch} /></td></tr>
                ) : !incidents.length ? (
                  <tr><td colSpan={8}><EmptyState icon="🚨" title="보고된 사고마약류가 없습니다" /></td></tr>
                ) : incidents.map((inc) => (
                  <tr key={inc.id} className="border-b border-gray-50 align-top">
                    <td className="px-4 py-3 text-xs text-gray-500"><KDate value={inc.occurredAt} mode="datetime" /></td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-900"><T k={INCIDENT_TYPE_LABEL[inc.incidentType] ?? inc.incidentType} /></td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{inc.drugName}</p>
                      <p className="text-[10px] text-gray-400 whitespace-pre-line max-w-md">{inc.description}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700"><Qty value={inc.quantity} unit={inc.unit} /></td>
                    <td className="px-4 py-3 text-xs"><StaffName familyName={inc.reporter?.familyName} givenName={inc.reporter?.givenName} /></td>
                    <td className="px-4 py-3"><StatusBadge status={inc.status} config={INCIDENT_STATUS_CONFIG} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500"><KDate value={inc.filedAt} mode="datetime" unknown="PENDING" /></td>
                    <td className="px-4 py-3 text-right">
                      {inc.status !== 'CLOSED' && !inc.filedAt && (
                        <button
                          onClick={() => {
                            const ref = window.prompt(tAttr('관할 관청 접수번호를 입력하십시오(모르면 비워 두십시오 — 미기재로 기록됩니다)')) ?? '';
                            fileIncidentMut.mutate({ id: inc.id, filedRef: ref.trim() });
                          }}
                          disabled={fileIncidentMut.isPending}
                          className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap disabled:opacity-50">
                          <T k="신고 기록" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 통계 ── */}
      {tab === 'stats' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium mb-3"><T k="등급별 취급 건수" /></p>
            {!stats ? <EmptyState compact title={statsQ.isLoading ? '집계 중…' : '집계를 불러오지 못했습니다'} /> : (
              <div className="space-y-2">
                {Object.keys(stats.bySchedule).length === 0
                  ? <EmptyState compact title="취급 기록이 없습니다" />
                  : Object.entries(stats.bySchedule).sort(([a], [b]) => a.localeCompare(b)).map(([sch, count]) => (
                    <div key={sch} className="flex items-center justify-between">
                      <ScheduleBadge schedule={sch} />
                      <span className="text-sm font-bold text-gray-900">{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium mb-3"><T k="상태별 건수" /></p>
            {!stats ? <EmptyState compact title={statsQ.isLoading ? '집계 중…' : '집계를 불러오지 못했습니다'} /> : (
              <div className="space-y-2">
                {Object.keys(stats.byStatus).length === 0
                  ? <EmptyState compact title="취급 기록이 없습니다" />
                  : Object.entries(stats.byStatus).map(([st, count]) => (
                    <div key={st} className="flex items-center justify-between">
                      <StatusBadge status={st} config={CS_STATUS_CONFIG} />
                      <span className="text-sm font-bold text-gray-900">{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div>
              <p className="text-xs text-gray-500 font-medium"><T k="NIMS 취급보고" /></p>
              <p className="text-sm text-gray-900 mt-1">
                <T k="전체@합계" /> {statNum(stats?.nims?.total)} · <b className="text-orange-700"><T k="미전송" /> {statNum(stats?.nims?.notTransmitted)}</b>
              </p>
              {stats?.nims && !stats.nims.implemented && (
                <p className="text-[10px] text-amber-600 mt-1">{stats.nims.channel} <T k="연동 미구축 — 전송된 건이 없습니다" /></p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium"><T k="사고마약류(미종결)" /></p>
              <p className="text-2xl font-bold text-red-700">{statNum(stats?.openIncidents)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium"><T k="유용 의심(실사 불일치)" /></p>
              <p className="text-2xl font-bold text-rose-700">{statNum(stats?.discrepancyCount)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
