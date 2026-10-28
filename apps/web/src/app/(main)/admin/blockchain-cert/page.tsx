'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';
import { kdate } from '@/lib/ui-settings';

import { useState, useEffect } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

// ---------------------------------------------------------------------------
// Types (API response shapes)
// ---------------------------------------------------------------------------

/** API: GET /api/v1/blockchain-cert/stats → { data: { ACTIVE: N, SUSPENDED: N, ... } } */
type RawStatsResponse = { data: Record<string, number> };

/** API: GET /api/v1/blockchain-cert/all → { data: [...], meta: {...} } */
interface RawCertRecord {
  id: string;
  serialNumber: string;
  ownerType: 'STAFF' | 'PATIENT';
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  issuedAt: string;
  pinFailCount: number;
  lastBackupAt?: string;
  previousCertId?: string;
  licenseNumber?: string;
  department?: string;
  patientMrn?: string;
  user?: { id: string; familyName: string; givenName: string } | null;
  patient?: { id: string; familyName: string; givenName: string; mrn?: string } | null;
}

interface RawCertsResponse {
  data: RawCertRecord[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** API: GET /api/v1/blockchain-cert/audit-log → { data: [...], meta: {...} } */
interface RawAuditLogEntry {
  id: string;
  certificateId?: string;
  actorType: string;
  userId?: string;
  patientId?: string;
  eventType: string;
  eventDetail?: Record<string, unknown> | null;
  ipAddress?: string;
  createdAt: string;
}

interface RawAuditLogResponse {
  data: RawAuditLogEntry[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// Display types (mapped from API)

interface CertDisplay {
  id: string;
  serialNumber: string;
  ownerType: 'STAFF' | 'PATIENT';
  ownerName: string;
  department?: string;
  mrn?: string;
  licenseNumber?: string;
  algorithm: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  fingerprint: string;
  publicKey: string;
  issuedAt: string;
  pinFailCount: number;
  lastBackupAt?: string;
  previousCertId?: string;
}

interface AuditLogDisplay {
  id: string;
  eventType: string;
  certId: string;
  actorType: string;
  detail: string;
  ipAddress: string;
  createdAt: string;
}

interface SignHistoryEntry {
  id: string;
  documentType: string;
  documentId: string;
  signerName: string;
  signerRole: string;
  certSerialNumber: string;
  blockchainStatus: string;
  signedAt: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapCert(raw: RawCertRecord): CertDisplay {
  let ownerName = '-';
  if (raw.ownerType === 'STAFF' && raw.user) {
    ownerName = `${raw.user.familyName}${raw.user.givenName}`;
  } else if (raw.ownerType === 'PATIENT' && raw.patient) {
    ownerName = `${raw.patient.familyName}${raw.patient.givenName}`;
  }

  return {
    id: raw.id,
    serialNumber: raw.serialNumber,
    ownerType: raw.ownerType,
    ownerName,
    department: raw.department,
    mrn: raw.ownerType === 'PATIENT' ? (raw.patient?.mrn ?? raw.patientMrn) : undefined,
    licenseNumber: raw.licenseNumber,
    algorithm: raw.algorithm,
    status: raw.status,
    fingerprint: raw.fingerprint,
    publicKey: raw.publicKey,
    issuedAt: raw.issuedAt,
    pinFailCount: raw.pinFailCount,
    lastBackupAt: raw.lastBackupAt,
    previousCertId: raw.previousCertId,
  };
}

function mapAuditLog(raw: RawAuditLogEntry): AuditLogDisplay {
  const detail = raw.eventDetail
    ? Object.entries(raw.eventDetail)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    : '-';

  return {
    id: raw.id,
    eventType: raw.eventType,
    certId: raw.certificateId
      ? raw.certificateId.length > 16
        ? `${raw.certificateId.slice(0, 16)}...`
        : raw.certificateId
      : '-',
    actorType: raw.actorType,
    detail,
    ipAddress: raw.ipAddress ?? '-',
    createdAt: raw.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  SUSPENDED: 'bg-orange-50 text-orange-700',
  REVOKED: 'bg-red-50 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: '승인 대기',
  ACTIVE: '활성',
  SUSPENDED: '정지',
  REVOKED: '폐기',
};

/** UI 크롬 언어 — 상태 라벨은 ko 정본 그대로 두고 렌더 키만 문맥화한다.
 *  '폐기'는 물품 폐기(Disposed)와 동음이의라 인증서 상태에는 `폐기@인증서상태`(Revoked)를 쓴다
 *  (같은 화면의 상태 필터 <option> 이 이미 그 키를 쓴다 — 배지와 갈라지면 한 화면이 두 말을 한다).
 *  ⚠ '정지'도 같은 문제가 있다(먼저 등록된 `정지` 는 버튼 동사 Suspend) — 문맥 키로 가르면 추가 언어 팩 5종에
 *  결손이 생겨 팩과 함께 해야 한다(2026-09-11 admin10 갈래 보고 · 팩은 그 갈래 소유가 아니다). */
const certStatusKey = (label: string) => (label === '폐기' ? '폐기@인증서상태' : label);

const OWNER_TYPE_STYLE: Record<string, string> = {
  STAFF: 'bg-blue-50 text-blue-700',
  PATIENT: 'bg-violet-50 text-violet-700',
};

const OWNER_TYPE_LABEL: Record<string, string> = {
  STAFF: '의료인',
  PATIENT: '환자',
};

const AUDIT_EVENT_COLOR: Record<string, string> = {
  ISSUED: 'bg-emerald-50 text-emerald-700',
  REVOKED: 'bg-red-50 text-red-700',
  SUSPENDED: 'bg-orange-50 text-orange-700',
  RESTORED: 'bg-blue-50 text-blue-700',
  PIN_FAILED: 'bg-amber-50 text-amber-700',
  PIN_LOCKED: 'bg-red-50 text-red-700',
  SIGN_SUCCESS: 'bg-emerald-50 text-emerald-700',
  SIGN_FAILED: 'bg-red-50 text-red-700',
};

const DOC_TYPE_LABEL: Record<string, string> = {
  ENCOUNTER: '진료기록',
  CONSENT: '동의서',
  PRESCRIPTION: '처방전',
  DISPENSING: '조제기록',
  DISCHARGE_SUMMARY: '퇴원요약',
  PATHOLOGY_REPORT: '병리보고서',
  LAB_WORKSHEET: '검사워크시트',
};

const SIGNER_ROLE_LABEL: Record<string, string> = {
  PRIMARY: '주서명',
  WITNESS: '확인자',
  CONSENT: '동의',
};

const ACTOR_TYPE_LABEL: Record<string, string> = {
  STAFF: '직원',
  PATIENT: '환자',
  SYSTEM: '시스템',
};

type Tab = 'list' | 'audit' | 'signatures' | 'policy' | 'guide';

// ---------------------------------------------------------------------------
// sign 단독 전환 — 읽기전용 미러 뷰 (관리는 sign 소관)
// ---------------------------------------------------------------------------

interface SignCertRow { userId: string; name: string; role: string; department: string | null; signCertSerial: string | null; enrolled: boolean }
// 🔴 W8 — issuedAt 은 '모를 수 있는 값'이다(sign 발급분은 HIS 에 발급 시각이 없다). null 을 허용하고 '미상'으로 적는다.
interface PatientCertRow { patientId: string; name: string; mrn: string | null; signCertSerial: string | null; issuedAt: string | null }

const CHO_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CHO_DOUBLE: Record<string, string> = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' };
const CHO_TABS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ', '#'];
function chosung(name: string): string {
  const c = (name || '').charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) {
    const base = CHO_LIST[Math.floor((c - 0xac00) / 588)];
    return CHO_DOUBLE[base] ?? base;
  }
  return '#'; // 비한글(영문·숫자 등)
}

function SignCertMirrorView() {
  const tAttr = useTAttr();
  const [view, setView] = useState<'staff' | 'patient'>('staff');
  const [q, setQ] = useState('');
  const [initial, setInitial] = useState('ㄱ');

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['sign-cert-status'],
    queryFn: () => apiClient.get<{ data: { total: number; enrolled: number; staff: SignCertRow[] } }>('/api/v1/blockchain-cert/sign-certs'),
    enabled: view === 'staff',
  });
  const { data: patData, isLoading: patLoading } = useQuery({
    queryKey: ['sign-cert-patients'],
    queryFn: () => apiClient.get<{ data: { total: number; patients: PatientCertRow[] } }>('/api/v1/blockchain-cert/sign-certs/patients'),
    enabled: view === 'patient',
  });

  const sd = staffData?.data;
  const staff = sd?.staff ?? [];
  const staffFiltered = staff.filter((s) => !q || s.name.includes(q) || (s.signCertSerial ?? '').toLowerCase().includes(q.toLowerCase()) || s.role.toLowerCase().includes(q.toLowerCase()));

  const patients = patData?.data?.patients ?? [];
  const patCounts: Record<string, number> = {};
  patients.forEach((p) => { const k = chosung(p.name); patCounts[k] = (patCounts[k] ?? 0) + 1; });
  const patFiltered = patients.filter((p) => chosung(p.name) === initial && (!q || p.name.includes(q) || (p.mrn ?? '').includes(q) || (p.signCertSerial ?? '').toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="sign 전자서명 인증서 현황" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="sign 발급 인증서(serial) 미러 — 읽기전용. 발급·폐기는 sign 관리자에서 수행합니다." /></p>
      </div>

      {/* sign 관리자 안내 */}
      <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <p className="text-sm text-indigo-900 font-medium mb-2"><T k="인증서 발급·관리는 sign 전자서명 서비스에서 수행합니다" /></p>
        <ul className="text-xs text-indigo-700 space-y-0.5 list-disc list-inside">
          <li><T k="인증서 목록·관리 (검색·상태배지·중단/재개/폐기)" /></li>
          <li><T k="신규 발급 · 폐기/OCSP·CRL" /></li>
          <li><T k="감사·로그 (CA 회전·관리 행위자)" /></li>
        </ul>
        <p className="text-[11px] text-indigo-500 mt-2"><T k="HIS는 발급된 serial 미러만 표시합니다 — 서명 시 sign 이 자동 발급하고 webhook 으로 반영됩니다." /></p>
      </div>

      {/* 직원 / 환자 토글 */}
      <div className="flex gap-2 mb-5">
        {([['staff', '직원'], ['patient', '환자']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setView(key); setQ(''); }}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-colors ${view === key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <T k={label} />{key === 'staff' && sd ? ` (${sd.enrolled}/${sd.total})` : ''}{key === 'patient' && patData ? ` (${patData.data.total})` : ''}
          </button>
        ))}
      </div>
      {/* 🔴 분모를 말한다(S12) — 이 수는 **전체 사용자 계정** 중 sign serial 보유(비활성 계정 포함)이고,
          인증 관리 콘솔(/admin/identity)의 「인증서 활성」은 HIS 인증서 원장(직원·ACTIVE)을 센다 — 같은 말로 보이지만 세는 대상이 다르다. */}
      {view === 'staff' && sd && (
        <p data-testid="staff-cert-denominator" className="text-[11px] text-gray-400 -mt-3 mb-4">
          <Tf
            k="sign serial 보유 {등재} / 전체 사용자 계정 {전체} — 비활성 계정을 포함해 센다. 인증 관리 콘솔의 「인증서 활성」(HIS 인증서 원장 · 직원 · ACTIVE)과는 세는 대상이 다르다."
            params={{ 등재: sd.enrolled, 전체: sd.total }}
          />
        </p>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={view === 'staff' ? tAttr('이름·역할·serial 검색') : tAttr('이름·MRN·serial 검색')}
        className="w-full sm:w-80 mb-4 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
      />

      {view === 'staff' ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {staffLoading ? (
            <div className="p-8 animate-pulse space-y-3"><div className="h-4 bg-gray-100 rounded w-1/3" /><div className="h-4 bg-gray-50 rounded w-1/2" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="직원" /></th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="역할" /></th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="부서" /></th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="sign 인증서 serial" /></th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                </tr>
              </thead>
              <tbody>
                {staffFiltered.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400"><T k="표시할 직원이 없습니다." /></td></tr>
                ) : staffFiltered.map((s) => (
                  <tr key={s.userId} className="border-t border-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-5 py-3 text-gray-600">{s.role}</td>
                    <td className="px-5 py-3 text-gray-500">{s.department ?? '-'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-700">{s.signCertSerial ?? '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s.enrolled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        <T k={s.enrolled ? '발급됨' : '미발급'} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          {/* 초성 탭 */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {CHO_TABS.map((ch) => {
              const cnt = patCounts[ch] ?? 0;
              return (
                <button
                  key={ch}
                  onClick={() => setInitial(ch)}
                  className={`min-w-[40px] px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${initial === ch ? 'bg-blue-600 text-white' : cnt > 0 ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-gray-50 text-gray-300'}`}
                >
                  {ch}{cnt > 0 ? <span className="text-[10px] ml-0.5 opacity-70">{cnt}</span> : ''}
                </button>
              );
            })}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {patLoading ? (
              <div className="p-8 animate-pulse space-y-3"><div className="h-4 bg-gray-100 rounded w-1/3" /><div className="h-4 bg-gray-50 rounded w-1/2" /></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">MRN</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="sign 인증서 serial" /></th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="발급일" /></th>
                  </tr>
                </thead>
                <tbody>
                  {patFiltered.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400"><Tf k="'{초성}' 초성에 sign 인증서 발급 환자가 없습니다." params={{ 초성: initial }} /></td></tr>
                  ) : patFiltered.map((p) => (
                    <tr key={p.patientId} className="border-t border-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{p.name}</td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">{p.mrn ?? '-'}</td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-700">{p.signCertSerial ?? '-'}</td>
                      <td className="px-5 py-3 text-gray-500">{p.issuedAt ?kdate(p.issuedAt, 'date') : <span className="text-gray-400"><T k="미상" /></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BlockchainCertAdminPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('list');

  // --- Tab 1: List filters ---
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerTypeFilter, setOwnerTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revokeReasonMap, setRevokeReasonMap] = useState<Record<string, string>>({});

  // --- Tab 2: Audit filters ---
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditEventType, setAuditEventType] = useState('');
  const [auditUser, setAuditUser] = useState('');
  const [auditPage, setAuditPage] = useState(1);

  // --- Tab 3: Signature filters ---
  const [sigFrom, setSigFrom] = useState('');
  const [sigTo, setSigTo] = useState('');
  const [sigDocType, setSigDocType] = useState('');
  const [sigSigner, setSigSigner] = useState('');
  const [sigPage, setSigPage] = useState(1);

  // --- Tab 4: Policy state ---
  const [policyAlgoEcdsa, setPolicyAlgoEcdsa] = useState(true);
  const [policyAlgoRsa, setPolicyAlgoRsa] = useState(true);
  const [pinLength, setPinLength] = useState(6);
  const [pinLockAttempts, setPinLockAttempts] = useState(5);
  const [pinLockMinutes, setPinLockMinutes] = useState(10);
  const [pinAutoSuspend, setPinAutoSuspend] = useState(10);
  const [anchorInterval, setAnchorInterval] = useState('1h');
  const [patientCertPolicy, setPatientCertPolicy] = useState<'manual' | 'auto-verified' | 'auto-email' | 'auto-all'>('manual');

  // --- 자동발급 정책 (이벤트별) ---
  const [autoIssuePolicy, setAutoIssuePolicy] = useState<Record<string, boolean>>({
    admission: false,
    discharge: false,
    surgeryConsent: false,
    prescriptionSign: false,
    labReport: false,
  });

  // --- Load saved policy from config-runtime ---
  const { data: savedPolicy } = useQuery({
    queryKey: ['blockchain-cert-policy'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/blockchain-cert/policy'),
    enabled: activeTab === 'policy',
  });

  // 발급 가능 여부 — sign 단독 전환 시 HIS 자체발급 폐지(서명 시 sign 자동 발급).
  const { data: capData } = useQuery({
    queryKey: ['blockchain-cert-capability'],
    queryFn: () => apiClient.get<{ data: { selfIssuanceEnabled: boolean; message: string | null } }>('/api/v1/blockchain-cert/capability'),
  });
  const selfIssuanceDisabled = capData?.data?.selfIssuanceEnabled === false;

  useEffect(() => {
    const p = savedPolicy?.data as Record<string, unknown> | undefined;
    if (!p) return;
    const algos = p.allowedAlgorithms as string[] | undefined;
    if (algos) {
      setPolicyAlgoEcdsa(algos.includes('ECDSA_P256'));
      setPolicyAlgoRsa(algos.includes('RSA_2048'));
    }
    if (p.pinLength != null) setPinLength(p.pinLength as number);
    if (p.pinLockAttempts != null) setPinLockAttempts(p.pinLockAttempts as number);
    if (p.pinLockMinutes != null) setPinLockMinutes(p.pinLockMinutes as number);
    if (p.pinAutoSuspendAttempts != null) setPinAutoSuspend(p.pinAutoSuspendAttempts as number);
    if (p.anchorInterval != null) setAnchorInterval(p.anchorInterval as string);
    if (p.patientCertPolicy != null) setPatientCertPolicy(p.patientCertPolicy as 'manual' | 'auto-verified' | 'auto-email' | 'auto-all');
    if (p.autoIssuePolicy != null) setAutoIssuePolicy(p.autoIssuePolicy as Record<string, boolean>);
  }, [savedPolicy]);

  // --- Notify modal ---
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState<'ALL' | 'DOCTOR' | 'NURSE' | 'PHARMACIST'>('ALL');
  /**
   * 🔴 (2026-09-03) 종전 '안내 발송'은 **발송 코드 없이 toast.success 만** 띄웠다(P16).
   *    실제 EP(notify-setup)로 배선 — 결과는 서버의 {attempted,sent,failed} 를 그대로 말한다.
   */
  const notifyMut = useMutation({
    mutationFn: (target: string) => apiClient.post<{ data: { attempted: number; sent: number; failed: number } }>('/api/v1/blockchain-cert/notify-setup', { target }),
    onSuccess: (res) => {
      const r = res.data;
      if (!r || r.attempted === 0) toast.info(tAttr('발송 대상(미발급 직원)이 없습니다.'));
      else if (r.failed > 0) toast.warning(tfAttr('안내 발송 {발송}/{시도}건 — {실패}건 실패', { 발송: r.sent, 시도: r.attempted, 실패: r.failed }));
      else toast.success(tfAttr('인증서 설정 안내를 {수}명에게 발송했습니다.', { 수: r.sent }));
      setShowNotifyModal(false);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? tAttr('안내 발송에 실패했습니다.')),
  });

  // ===================== QUERIES =====================

  // Stats: API returns { data: { ACTIVE: N, SUSPENDED: N, REVOKED: N, ... } }
  const { data: rawStatsData } = useQuery({
    queryKey: ['blockchain-cert-stats'],
    queryFn: () => apiClient.get<RawStatsResponse>('/api/v1/blockchain-cert/stats'),
  });
  const rawStats = rawStatsData?.data as Record<string, number> | undefined;
  const stats = rawStats
    ? {
        total: Object.values(rawStats).reduce((a, b) => a + b, 0),
        active: rawStats['ACTIVE'] ?? 0,
        suspendedRevoked: (rawStats['SUSPENDED'] ?? 0) + (rawStats['REVOKED'] ?? 0),
        todaySignatures: 0, // not available from this endpoint
      }
    : undefined;

  // All certs: API returns { data: [...], meta: {...} } with user/patient relations
  const { data: rawCertsData, isLoading: certsLoading, isError, error, refetch } = useQuery({
    queryKey: ['blockchain-cert-all', search, statusFilter, ownerTypeFilter],
    queryFn: () =>
      apiClient.get<RawCertsResponse>('/api/v1/blockchain-cert/all', {
        search: search || undefined,
        status: statusFilter || undefined,
        ownerType: ownerTypeFilter || undefined,
      }),
  });
  const certs: CertDisplay[] = (rawCertsData?.data ?? []).map(mapCert);

  // Audit log: API returns { data: [...CertificateAuditLog], meta: {...} }
  const { data: rawAuditData } = useQuery({
    queryKey: ['blockchain-cert-audit', auditFrom, auditTo, auditEventType, auditUser, auditPage],
    queryFn: () =>
      apiClient.get<RawAuditLogResponse>('/api/v1/blockchain-cert/audit-log', {
        from: auditFrom || undefined,
        to: auditTo || undefined,
        eventType: auditEventType || undefined,
        userId: auditUser || undefined,
        page: auditPage,
        limit: 20,
      }),
    enabled: activeTab === 'audit',
  });
  const auditLogs: AuditLogDisplay[] = (rawAuditData?.data ?? []).map(mapAuditLog);
  const auditTotal = rawAuditData?.meta?.total ?? 0;

  // Signatures: API endpoint may not exist yet, keep query but handle gracefully
  const { data: sigData, isError: sigIsError, error: sigError, refetch: refetchSig } = useQuery({
    queryKey: ['document-sign-history', sigFrom, sigTo, sigDocType, sigSigner, sigPage],
    queryFn: () =>
      apiClient.get<{ data: SignHistoryEntry[]; meta: { total: number } }>(
        '/api/v1/document-sign/history',
        {
          from: sigFrom || undefined,
          to: sigTo || undefined,
          documentType: sigDocType || undefined,
          signer: sigSigner || undefined,
          page: sigPage,
          limit: 20,
        },
      ),
    enabled: activeTab === 'signatures',
  });
  const rawSigArr = sigData?.data;
  const signatures: SignHistoryEntry[] = Array.isArray(rawSigArr) ? rawSigArr : (rawSigArr as unknown as Record<string, unknown>)?.data as SignHistoryEntry[] ?? [];
  const sigTotal = (sigData as unknown as { meta?: { total: number } })?.meta?.total ?? signatures.length;

  // ===================== MUTATIONS =====================

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['blockchain-cert-all'] });
    queryClient.invalidateQueries({ queryKey: ['blockchain-cert-stats'] });
    queryClient.invalidateQueries({ queryKey: ['blockchain-cert-audit'] });
  };

  /**
   * 🔴 서버가 실제로 승인했을 때만 "승인되었습니다"라고 말한다(D3·2026-09-15).
   *    종전 서버는 아무것도 하지 않는 no-op 이었는데 이 토스트는 늘 성공을 알렸다 — 상태는 PENDING 그대로였다.
   */
  const approveMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: { approved?: boolean } }>(`/api/v1/blockchain-cert/${id}/approve`),
    onSuccess: (res) => {
      if (res?.data?.approved === false) toast.info(tAttr('이미 활성 상태입니다 — 바뀐 것이 없습니다.'));
      else toast.success(tAttr('인증서가 승인되었습니다.'));
      invalidateAll();
    },
    onError: () => toast.error(tAttr('승인 처리에 실패했습니다.')),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/api/v1/blockchain-cert/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success(tAttr('인증서 발급이 거부되었습니다.'));
      invalidateAll();
    },
    onError: () => toast.error(tAttr('거부 처리에 실패했습니다.')),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/blockchain-cert/${id}/suspend`),
    onSuccess: () => {
      toast.success(tAttr('인증서가 정지되었습니다.'));
      invalidateAll();
    },
    onError: () => toast.error(tAttr('정지 처리에 실패했습니다.')),
  });

  const revokeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/api/v1/blockchain-cert/${id}/revoke`, { reason }),
    onSuccess: () => {
      toast.success(tAttr('인증서가 폐기되었습니다. (비가역)'));
      invalidateAll();
    },
    onError: () => toast.error(tAttr('폐기 처리에 실패했습니다.')),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/blockchain-cert/${id}/restore`),
    onSuccess: () => {
      toast.success(tAttr('인증서가 복원되었습니다.'));
      invalidateAll();
    },
    onError: () => toast.error(tAttr('복원에 실패했습니다.')),
  });

  const savePolicyMutation = useMutation({
    mutationFn: () =>
      apiClient.put('/api/v1/blockchain-cert/policy', {
        allowedAlgorithms: [
          ...(policyAlgoEcdsa ? ['ECDSA_P256'] : []),
          ...(policyAlgoRsa ? ['RSA_2048'] : []),
        ],
        pinLength,
        pinLockAttempts,
        pinLockMinutes,
        pinAutoSuspendAttempts: pinAutoSuspend,
        anchorInterval,
        patientCertPolicy,
        autoIssuePolicy,
      }),
    onSuccess: () => {
      toast.success(tAttr('정책이 저장되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['blockchain-cert-policy'] });
    },
    onError: () => toast.error(tAttr('정책 저장에 실패했습니다.')),
  });

  // ===================== TABS =====================

  const tabs: { key: Tab; label: string }[] = [
    { key: 'list', label: '인증서 목록' },
    { key: 'audit', label: '감사 로그' },
    { key: 'signatures', label: '서명 이력' },
    { key: 'policy', label: '정책 설정' },
    { key: 'guide', label: '시스템 안내' },
  ];

  const fmtDate = (d: string) =>kdate(d, 'date');
  const fmtDateTime = (d: string) => kdate(d, 'datetimeSec');
  const PAGE_LIMIT = 20;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // sign 단독 전환 — 자체발급 관리 콘솔 대신 읽기전용 미러(관리는 sign 소관).
  if (selfIssuanceDisabled) return <SignCertMirrorView />;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="블록체인 인증서 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="전자서명 인증서 관리, 감사 로그, 서명 이력 조회" /></p>
        </div>
        <button
          onClick={() => setShowNotifyModal(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <T k="직원에게 인증서 설정 안내 발송" />
        </button>
      </div>

      {/* Notify Modal */}
      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3"><T k="인증서 설정 안내 발송" /></h3>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
              <p className="text-sm text-blue-800 leading-relaxed">
                <T k="블록체인 인증서의 개인키는 보안상 직원의 브라우저에서 직접 생성해야 합니다. 관리자가 대리 발급할 수 없으며, 직원이 직접 인증서 설정 페이지에서 개인키를 생성하고 인증서를 발급받아야 서명이 가능합니다." />
              </p>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              <T k="선택한 직원에게 인증서 설정 안내 알림을 전송합니다." />
            </p>
            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1"><T k="대상 직원 (미발급자)" /></label>
              <select
                value={notifyTarget}
                onChange={(e) => setNotifyTarget(e.target.value as typeof notifyTarget)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="ALL">{tAttr('전체 미발급 직원')}</option>
                <option value="DOCTOR">{tAttr('의사 중 미발급')}</option>
                <option value="NURSE">{tAttr('간호사 중 미발급')}</option>
                <option value="PHARMACIST">{tAttr('약사 중 미발급')}</option>
              </select>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowNotifyModal(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <T k="취소" />
              </button>
              <button
                onClick={() => notifyMut.mutate(notifyTarget)}
                disabled={notifyMut.isPending}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-40"
              >
                <T k={notifyMut.isPending ? '발송 중…' : '안내 발송'} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '전체 인증서', value: stats?.total ?? 0, color: 'text-blue-600' },
          { label: '활성', value: stats?.active ?? 0, color: 'text-emerald-600' },
          { label: '정지/폐기', value: stats?.suspendedRevoked ?? 0, color: 'text-red-600' },
          { label: '오늘 서명', value: stats?.todaySignatures ?? 0, color: 'text-indigo-600' },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center"
          >
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs font-medium text-gray-500 mt-1"><T k={s.label} /></p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* ================================================================= */}
      {/* Tab 1: 인증서 목록                                                */}
      {/* ================================================================= */}
      {activeTab === 'list' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* 환자/직원 서브탭 */}
          <div className="px-5 pt-4 pb-2 border-b border-gray-100">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit mb-3">
              {[
                { key: '', label: '전체', count: certs.length },
                { key: 'PENDING', label: '승인 대기', count: certs.filter(c => c.status === 'PENDING').length },
                { key: 'STAFF', label: '직원 인증서', count: certs.filter(c => c.ownerType === 'STAFF').length },
                { key: 'PATIENT', label: '환자 인증서', count: certs.filter(c => c.ownerType === 'PATIENT').length },
              ].map(sub => (
                <button key={sub.key} onClick={() => { if (sub.key === 'PENDING') { setStatusFilter('PENDING'); setOwnerTypeFilter(''); } else if (sub.key === 'STAFF' || sub.key === 'PATIENT') { setOwnerTypeFilter(sub.key); setStatusFilter(''); } else { setOwnerTypeFilter(''); setStatusFilter(''); } }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    (sub.key === 'PENDING' && statusFilter === 'PENDING') || (sub.key === 'STAFF' && ownerTypeFilter === 'STAFF') || (sub.key === 'PATIENT' && ownerTypeFilter === 'PATIENT') || (sub.key === '' && !statusFilter && !ownerTypeFilter)
                      ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  <T k={sub.label} /> {sub.count > 0 && <span className={`ml-1 ${sub.key === 'PENDING' ? 'text-amber-600 font-bold' : 'text-gray-400'}`}>({sub.count})</span>}
                </button>
              ))}
            </div>
            <div className="flex gap-3 flex-wrap">
              <input
                type="text"
                placeholder={tAttr('이름/부서/일련번호 검색...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">{tAttr('전체 상태')}</option>
                <option value="PENDING">{tAttr('승인 대기')}</option>
                <option value="ACTIVE">{tAttr('활성')}</option>
                <option value="SUSPENDED">{tAttr('정지')}</option>
                <option value="REVOKED">{tAttr('폐기@인증서상태')}</option>
              </select>
              <select
                value={ownerTypeFilter}
                onChange={(e) => setOwnerTypeFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">{tAttr('전체 유형')}</option>
                <option value="STAFF">{tAttr('의료인')}</option>
                <option value="PATIENT">{tAttr('환자')}</option>
              </select>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="일련번호" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="소유자" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="부서/MRN" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="알고리즘" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="발급일" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500"><T k="액션" /></th>
              </tr>
            </thead>
            <tbody>
              {certsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td colSpan={8} className="px-5 py-3">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : certs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-gray-400">
                    <T k="인증서가 없습니다." />
                  </td>
                </tr>
              ) : (
                certs.map((c) => (
                  <>
                    <tr
                      key={c.id}
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-5 py-3 text-gray-500 font-mono text-xs">
                        {c.serialNumber.length > 20
                          ? `${c.serialNumber.slice(0, 20)}...`
                          : c.serialNumber}
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-900">{c.ownerName}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                            OWNER_TYPE_STYLE[c.ownerType] ?? 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <T k={OWNER_TYPE_LABEL[c.ownerType] ?? c.ownerType} />
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {c.ownerType === 'STAFF' ? c.department ?? '-' : c.mrn ?? '-'}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{c.algorithm}</td>
                      <td className="px-5 py-3 text-gray-500">{fmtDate(c.issuedAt)}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                            STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <T k={certStatusKey(STATUS_LABEL[c.status] ?? c.status)} />
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                          {c.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => {
                                  if (confirm(tfAttr('{이름}의 인증서를 승인하시겠습니까?', { 이름: c.ownerName }))) {
                                    approveMutation.mutate(c.id);
                                  }
                                }}
                                disabled={approveMutation.isPending}
                                className="min-h-[44px] px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                              >
                                <T k="승인@버튼" />
                              </button>
                              <button
                                onClick={() => {
                                  const reason = prompt(tAttr('거부 사유를 입력하세요:'));
                                  if (reason) rejectMutation.mutate({ id: c.id, reason });
                                }}
                                disabled={rejectMutation.isPending}
                                className="min-h-[44px] px-3 py-2 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
                              >
                                <T k="거부@행위" />
                              </button>
                            </>
                          )}
                          {c.status === 'ACTIVE' && (
                            <button
                              onClick={() => {
                                if (confirm(tfAttr('{이름}의 인증서를 정지하시겠습니까?', { 이름: c.ownerName }))) {
                                  suspendMutation.mutate(c.id);
                                }
                              }}
                              disabled={suspendMutation.isPending}
                              className="min-h-[44px] px-3 py-2 rounded-lg border border-orange-200 text-orange-700 text-xs font-medium hover:bg-orange-50 transition-colors disabled:opacity-50"
                            >
                              <T k="정지" />
                            </button>
                          )}
                          {c.status === 'SUSPENDED' && (
                            <button
                              onClick={() => restoreMutation.mutate(c.id)}
                              disabled={restoreMutation.isPending}
                              className="min-h-[44px] px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                              <T k="복원" />
                            </button>
                          )}
                          {c.status !== 'REVOKED' && (
                            <button
                              onClick={() =>
                                setExpandedId(expandedId === c.id ? null : c.id)
                              }
                              className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50 transition-colors"
                            >
                              <T k="폐기@버튼" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {expandedId === c.id && (
                      <tr key={`${c.id}-detail`} className="border-b border-gray-50">
                        <td colSpan={8} className="px-5 py-0">
                          <div className="bg-gray-50 rounded-xl p-5 my-3 space-y-3">
                            <h4 className="text-sm font-bold text-gray-700"><T k="인증서 상세" /></h4>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                              <div>
                                <span className="text-gray-400">S/N:</span>{' '}
                                <span className="font-mono text-gray-700">{c.serialNumber}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 inline-flex items-center gap-1">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src="/images/cert/icons/fingerprint.svg" alt="" width={14} height={14} />
                                  <T k="지문:" />
                                </span>{' '}
                                <span className="font-mono text-gray-700 text-xs">{c.fingerprint}</span>
                              </div>
                              <div>
                                <span className="text-gray-400"><T k="공개키:" /></span>{' '}
                                <span className="font-mono text-gray-700 text-xs">
                                  {c.publicKey.length > 40
                                    ? `${c.publicKey.slice(0, 40)}...`
                                    : c.publicKey}{' '}
                                  ({c.algorithm})
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400"><T k="발급일:" /></span>{' '}
                                <span className="text-gray-700">{fmtDateTime(c.issuedAt)}</span>
                              </div>
                              <div>
                                <span className="text-gray-400"><T k="소유자:" /></span>{' '}
                                <span className="text-gray-700">
                                  {c.ownerName}
                                  {c.licenseNumber ? <>{' '}<Tf k="(면허: {면허})" params={{ 면허: c.licenseNumber }} /></> : ''}
                                  {c.mrn ? ` (MRN: ${c.mrn})` : ''}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400"><T k="PIN 실패:" /></span>{' '}
                                <span className="text-gray-700">{c.pinFailCount}<Unit><T k="회" /></Unit></span>
                              </div>
                              <div>
                                <span className="text-gray-400"><T k="마지막 백업:" /></span>{' '}
                                <span className="text-gray-700">
                                  {c.lastBackupAt ? fmtDate(c.lastBackupAt) : '-'}
                                </span>
                              </div>
                              {c.previousCertId && (
                                <div className="col-span-2">
                                  <span className="text-gray-400"><T k="이전 인증서:" /></span>{' '}
                                  <span className="font-mono text-blue-600 text-xs">
                                    {c.previousCertId}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Inline revoke with reason */}
                            {c.status !== 'REVOKED' && (
                              <div className="pt-3 border-t border-gray-200">
                                <div className="flex items-end gap-3">
                                  {c.status === 'ACTIVE' && (
                                    <button
                                      onClick={() => {
                                        if (confirm(tfAttr('{이름}의 인증서를 정지하시겠습니까?', { 이름: c.ownerName }))) {
                                          suspendMutation.mutate(c.id);
                                        }
                                      }}
                                      disabled={suspendMutation.isPending}
                                      className="min-h-[44px] px-3 py-2 rounded-lg border border-orange-300 text-orange-700 text-xs font-medium hover:bg-orange-50 transition-colors disabled:opacity-50"
                                    >
                                      <T k="정지" />
                                    </button>
                                  )}
                                  {c.status === 'SUSPENDED' && (
                                    <button
                                      onClick={() => restoreMutation.mutate(c.id)}
                                      disabled={restoreMutation.isPending}
                                      className="min-h-[44px] px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                                    >
                                      <T k="복원" />
                                    </button>
                                  )}
                                  <div className="flex-1">
                                    <label className="block text-xs text-gray-500 mb-1">
                                      <T k="폐기 사유 (필수, 비가역)" />
                                    </label>
                                    <ReasonInput
                                      domain="certRevoke"
                                      required
                                      placeholder={tAttr('폐기 사유를 입력하세요...')}
                                      value={revokeReasonMap[c.id] ?? ''}
                                      onChange={(v) =>
                                        setRevokeReasonMap((prev) => ({
                                          ...prev,
                                          [c.id]: v,
                                        }))
                                      }
                                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                                    />
                                  </div>
                                  <button
                                    onClick={() => {
                                      const reason = revokeReasonMap[c.id]?.trim();
                                      if (!reason) {
                                        toast.error(tAttr('폐기 사유를 입력해주세요.'));
                                        return;
                                      }
                                      if (
                                        confirm(
                                          tfAttr('{이름}의 인증서를 폐기합니다.\n사유: {사유}\n\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?', { 이름: c.ownerName, 사유: reason }),
                                        )
                                      ) {
                                        revokeMutation.mutate({ id: c.id, reason });
                                      }
                                    }}
                                    disabled={revokeMutation.isPending}
                                    className="min-h-[44px] px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                                  >
                                    <T k="폐기@버튼" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 2: 감사 로그                                                  */}
      {/* ================================================================= */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="시작일" /></label>
              <input
                type="date"
                value={auditFrom}
                onChange={(e) => { setAuditFrom(e.target.value); setAuditPage(1); }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="종료일" /></label>
              <input
                type="date"
                value={auditTo}
                onChange={(e) => { setAuditTo(e.target.value); setAuditPage(1); }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="이벤트 유형" /></label>
              <select
                value={auditEventType}
                onChange={(e) => { setAuditEventType(e.target.value); setAuditPage(1); }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">{tAttr('전체')}</option>
                <option value="ISSUED">ISSUED</option>
                <option value="REVOKED">REVOKED</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="RESTORED">RESTORED</option>
                <option value="PIN_FAILED">PIN_FAILED</option>
                <option value="PIN_LOCKED">PIN_LOCKED</option>
                <option value="SIGN_SUCCESS">SIGN_SUCCESS</option>
                <option value="SIGN_FAILED">SIGN_FAILED</option>
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-1"><T k="행위자 검색" /></label>
              <input
                type="text"
                placeholder={tAttr('사용자 ID 검색...')}
                value={auditUser}
                onChange={(e) => { setAuditUser(e.target.value); setAuditPage(1); }}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="일시" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="이벤트 유형" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="대상 인증서" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="행위자 유형" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상세" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">IP</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-400">
                    <T k="감사 로그가 없습니다." />
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-500 text-xs">{fmtDateTime(log.createdAt)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                          AUDIT_EVENT_COLOR[log.eventType] ?? 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {log.eventType}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      {log.certId}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 whitespace-nowrap">
                        <T k={ACTOR_TYPE_LABEL[log.actorType] ?? log.actorType} />
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                      {log.detail}
                    </td>
                    <td className="px-5 py-3 text-gray-400 font-mono text-xs">{log.ipAddress}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {auditTotal > PAGE_LIMIT && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                <Tf k="총 {전체}건 중 {시작}-{끝}건" params={{ 전체: auditTotal, 시작: (auditPage - 1) * PAGE_LIMIT + 1, 끝: Math.min(auditPage * PAGE_LIMIT, auditTotal) }} />
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  disabled={auditPage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <T k="이전" />
                </button>
                <button
                  onClick={() => setAuditPage((p) => p + 1)}
                  disabled={auditPage * PAGE_LIMIT >= auditTotal}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <T k="다음" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 3: 서명 이력                                                  */}
      {/* ================================================================= */}
      {activeTab === 'signatures' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="시작일" /></label>
              <input
                type="date"
                value={sigFrom}
                onChange={(e) => { setSigFrom(e.target.value); setSigPage(1); }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="종료일" /></label>
              <input
                type="date"
                value={sigTo}
                onChange={(e) => { setSigTo(e.target.value); setSigPage(1); }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1"><T k="문서 유형" /></label>
              <select
                value={sigDocType}
                onChange={(e) => { setSigDocType(e.target.value); setSigPage(1); }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">{tAttr('전체')}</option>
                <option value="ENCOUNTER">{tAttr('진료기록')}</option>
                <option value="CONSENT">{tAttr('동의서')}</option>
                <option value="PRESCRIPTION">{tAttr('처방전')}</option>
                <option value="DISPENSING">{tAttr('조제기록')}</option>
                <option value="DISCHARGE_SUMMARY">{tAttr('퇴원요약')}</option>
                <option value="PATHOLOGY_REPORT">{tAttr('병리보고서')}</option>
                <option value="LAB_WORKSHEET">{tAttr('검사워크시트')}</option>
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-1"><T k="서명자 검색" /></label>
              <input
                type="text"
                placeholder={tAttr('이름 검색...')}
                value={sigSigner}
                onChange={(e) => { setSigSigner(e.target.value); setSigPage(1); }}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="일시" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="문서 유형" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="문서 ID" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="서명자" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="역할" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="인증서 S/N" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="블록체인" /></th>
              </tr>
            </thead>
            <tbody>
              {sigIsError ? (
                <tr>
                  <td colSpan={7} className="px-5 py-4">
                    <QueryErrorFallback error={sigError} onRetry={() => refetchSig()} size="compact" />
                  </td>
                </tr>
              ) : signatures.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-400">
                    <T k="서명 이력이 없습니다." />
                  </td>
                </tr>
              ) : (
                signatures.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-500 text-xs">{fmtDateTime(s.signedAt)}</td>
                    <td className="px-5 py-3">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-gray-100 text-gray-700">
                        <T k={DOC_TYPE_LABEL[s.documentType] ?? s.documentType} />
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      {(s.documentId ?? '').length > 12 ? `${s.documentId.slice(0, 12)}...` : (s.documentId ?? '-')}
                    </td>
                    <td className="px-5 py-3 text-gray-700">{s.signerName}</td>
                    <td className="px-5 py-3">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-indigo-50 text-indigo-700">
                        <T k={SIGNER_ROLE_LABEL[s.signerRole] ?? s.signerRole} />
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      {(s.certSerialNumber ?? '').length > 12
                        ? `${s.certSerialNumber.slice(0, 12)}...`
                        : (s.certSerialNumber ?? '-')}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                          s.blockchainStatus === 'ANCHORED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : s.blockchainStatus === 'PENDING'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        <T k={s.blockchainStatus === 'ANCHORED'
                          ? '앵커링 완료'
                          : s.blockchainStatus === 'PENDING'
                            ? '대기 중'
                            : s.blockchainStatus} />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {sigTotal > PAGE_LIMIT && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                <Tf k="총 {전체}건 중 {시작}-{끝}건" params={{ 전체: sigTotal, 시작: (sigPage - 1) * PAGE_LIMIT + 1, 끝: Math.min(sigPage * PAGE_LIMIT, sigTotal) }} />
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSigPage((p) => Math.max(1, p - 1))}
                  disabled={sigPage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <T k="이전" />
                </button>
                <button
                  onClick={() => setSigPage((p) => p + 1)}
                  disabled={sigPage * PAGE_LIMIT >= sigTotal}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <T k="다음" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 4: 정책 설정                                                  */}
      {/* ================================================================= */}
      {activeTab === 'policy' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-6"><T k="인증서 정책 설정" /></h3>
          <div className="space-y-6 max-w-xl">
            {/* 허용 알고리즘 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2"><T k="허용 알고리즘" /></label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={policyAlgoEcdsa}
                    onChange={(e) => setPolicyAlgoEcdsa(e.target.checked)}
                    className="rounded"
                  />
                  ECDSA P-256
                  <span className="text-[10px] text-emerald-600 font-medium ml-1"><T k="권장" /></span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={policyAlgoRsa}
                    onChange={(e) => setPolicyAlgoRsa(e.target.checked)}
                    className="rounded"
                  />
                  RSA-2048
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                <T k="둘 다 허용 시 직원이 키 생성 때 원하는 알고리즘을 선택합니다. 서명 검증은 알고리즘 자동 판별로 혼재 사용 가능합니다. 최소 1개는 반드시 선택해야 합니다." />
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-xs font-bold text-emerald-800 mb-1">ECDSA P-256</p>
                  <div className="space-y-0.5 text-[11px]">
                    <p className="text-emerald-700"><T k="+ 서명 속도 빠름 (RSA 대비 10배)" /></p>
                    <p className="text-emerald-700"><T k="+ 키 크기 작음 (32 bytes vs 256 bytes)" /></p>
                    <p className="text-emerald-700"><T k="+ 모바일/브라우저 최적화" /></p>
                    <p className="text-emerald-700"><T k="+ 현대 보안 표준 (NIST 권장)" /></p>
                    <p className="text-gray-500"><T k="- 일부 레거시 시스템 미지원" /></p>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-xs font-bold text-blue-800 mb-1">RSA-2048</p>
                  <div className="space-y-0.5 text-[11px]">
                    <p className="text-blue-700"><T k="+ 호환성 최고 (모든 시스템 지원)" /></p>
                    <p className="text-blue-700"><T k="+ 공인인증서 표준과 동일 방식" /></p>
                    <p className="text-blue-700"><T k="+ 법적 검증 사례 풍부" /></p>
                    <p className="text-gray-500"><T k="- 서명 속도 느림" /></p>
                    <p className="text-gray-500"><T k="- 키/서명 크기 큼 (저장 공간)" /></p>
                    <p className="text-gray-500"><T k="- 동일 보안 수준에 더 긴 키 필요" /></p>
                  </div>
                </div>
              </div>
            </div>

            {/* PIN 정책 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3"><T k="PIN 정책" /></label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1"><T k="PIN 길이" /></label>
                  <select
                    value={pinLength}
                    onChange={(e) => setPinLength(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value={4}>{tAttr('4자리')}</option>
                    <option value={6}>{tAttr('6자리')}</option>
                    <option value={8}>{tAttr('8자리')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1"><T k="실패 잠금 횟수" /></label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={pinLockAttempts}
                    onChange={(e) => setPinLockAttempts(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1"><T k="잠금 시간 (분)" /></label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={pinLockMinutes}
                    onChange={(e) => setPinLockMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1"><T k="자동 정지 횟수" /></label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={pinAutoSuspend}
                    onChange={(e) => setPinAutoSuspend(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 블록체인 앵커링 주기 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <T k="블록체인 앵커링 주기" />
              </label>
              <select
                value={anchorInterval}
                onChange={(e) => setAnchorInterval(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="immediate">{tAttr('즉시')}</option>
                <option value="30m">{tAttr('30분')}</option>
                <option value="1h">{tAttr('1시간')}</option>
                <option value="6h">{tAttr('6시간')}</option>
                <option value="1d">{tAttr('1일')}</option>
              </select>
            </div>

            {/* 환자 인증서 자동 발급 정책 */}
            <div className="border-t pt-6">
              <label className="block text-sm font-medium text-gray-700 mb-3"><T k="환자 인증서 발급 정책" /></label>
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="radio" name="patientCertPolicy" value="manual" checked={patientCertPolicy === 'manual'} onChange={() => setPatientCertPolicy('manual')} className="mt-1 rounded" />
                  <div>
                    <p className="text-sm font-medium text-gray-900"><T k="수동 승인" /></p>
                    <p className="text-xs text-gray-500"><T k="환자가 인증서를 신청하면 관리자가 수동으로 승인합니다." /></p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="radio" name="patientCertPolicy" value="auto-verified" checked={patientCertPolicy === 'auto-verified'} onChange={() => setPatientCertPolicy('auto-verified')} className="mt-1 rounded" />
                  <div>
                    <p className="text-sm font-medium text-gray-900"><T k="본인인증 완료 시 자동 승인" /></p>
                    <p className="text-xs text-gray-500"><T k="SMS 본인인증이 완료된 환자의 인증서를 자동으로 승인합니다." /></p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="radio" name="patientCertPolicy" value="auto-email" checked={patientCertPolicy === 'auto-email'} onChange={() => setPatientCertPolicy('auto-email')} className="mt-1 rounded" />
                  <div>
                    <p className="text-sm font-medium text-gray-900"><T k="이메일 인증 완료 시 자동 승인" /></p>
                    <p className="text-xs text-gray-500"><T k="이메일 인증이 완료된 환자의 인증서를 자동으로 승인합니다." /></p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="radio" name="patientCertPolicy" value="auto-all" checked={patientCertPolicy === 'auto-all'} onChange={() => setPatientCertPolicy('auto-all')} className="mt-1 rounded" />
                  <div>
                    <p className="text-sm font-medium text-gray-900"><T k="모든 환자 자동 승인" /></p>
                    <p className="text-xs text-gray-500"><T k="포털에 로그인한 모든 환자의 인증서 발급을 자동 승인합니다." /></p>
                    <p className="text-[10px] text-amber-600 mt-0.5">⚠ <T k="보안 수준이 낮아질 수 있습니다" /></p>
                  </div>
                </label>
              </div>
              <div className="mt-3 p-3 bg-blue-50 rounded-xl">
                <p className="text-xs text-blue-700">
                  <strong><T k="참고:" /></strong> <T k="환자 인증서는 동의서 전자서명에 사용됩니다. 의료인 인증서는 항상 자동 발급됩니다." />
                </p>
              </div>
            </div>

            {/* 이벤트별 자동발급 정책 */}
            <div className="border-t pt-6">
              <label className="block text-sm font-medium text-gray-700 mb-3"><T k="이벤트별 자동발급 정책" /></label>
              <p className="text-xs text-gray-500 mb-4"><T k="활성화된 이벤트 발생 시 해당 인증서를 자동으로 발급합니다." /></p>
              <div className="space-y-3">
                {([
                  { key: 'admission', label: '입원', desc: '환자 입원 시 입원확인서 인증서를 자동 발급합니다.' },
                  { key: 'discharge', label: '퇴원', desc: '환자 퇴원 시 퇴원요약서 인증서를 자동 발급합니다.' },
                  { key: 'surgeryConsent', label: '수술 동의', desc: '수술 동의서 서명 시 수술동의 인증서를 자동 발급합니다.' },
                  { key: 'prescriptionSign', label: '처방 서명', desc: '의사 처방 전자서명 시 처방 인증서를 자동 발급합니다.' },
                  { key: 'labReport', label: '검사 결과', desc: '검사 결과 확정 시 검사결과 인증서를 자동 발급합니다.' },
                ] as const).map((item) => (
                  <label key={item.key} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={autoIssuePolicy[item.key] ?? false}
                      onChange={(e) => setAutoIssuePolicy(prev => ({ ...prev, [item.key]: e.target.checked }))}
                      className="mt-1 rounded"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900"><T k={item.label} /></p>
                      <p className="text-xs text-gray-500"><T k={item.desc} /></p>
                    </div>
                  </label>
                ))}
              </div>
              <div className="mt-3 p-3 bg-amber-50 rounded-xl">
                <p className="text-xs text-amber-700">
                  <strong><T k="주의:" /></strong> <T k="자동발급 정책은 위의 환자 인증서 발급 정책과 함께 동작합니다. 수동 승인 모드에서는 자동발급된 인증서도 관리자 승인이 필요합니다." />
                </p>
              </div>
            </div>

            <button
              onClick={() => savePolicyMutation.mutate()}
              disabled={savePolicyMutation.isPending}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <T k={savePolicyMutation.isPending ? '저장 중...' : '저장'} />
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 5: 시스템 안내                                                 */}
      {/* ================================================================= */}
      {activeTab === 'guide' && (
        <div className="space-y-6">
          {/* 개요 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4"><T k="블록체인 전자인증서 시스템이란?" /></h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              위루비병원의 블록체인 전자인증서 시스템은 의료 문서(진단서, 처방전, 동의서, 수술기록 등)에
              법적 효력이 있는 <strong>전자서명</strong>을 적용하고, 서명 사실을 <strong>블록체인에 기록</strong>하여
              위변조를 방지하는 시스템입니다.
            </p>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-sm font-bold text-blue-900 mb-2"><T k="핵심 원칙" /></p>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
                  </div>
                  <p className="text-xs font-bold text-blue-800">Zero-Knowledge</p>
                  <p className="text-[11px] text-blue-600"><T k="개인키는 브라우저에만 저장" /></p>
                  <p className="text-[11px] text-blue-600"><T k="서버로 절대 전송 안 함" /></p>
                </div>
                <div className="text-center">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
                  </div>
                  <p className="text-xs font-bold text-blue-800"><T k="부인 방지" /></p>
                  <p className="text-[11px] text-blue-600"><T k="내부 원장에 서명 해시 기록" /></p>
                  <p className="text-[11px] text-blue-600"><T k="서명 사실 부인 불가" /></p>
                </div>
                <div className="text-center">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                  </div>
                  <p className="text-xs font-bold text-blue-800"><T k="무결성 검증" /></p>
                  <p className="text-[11px] text-blue-600"><T k="문서 해시(SHA-256) 비교" /></p>
                  <p className="text-[11px] text-blue-600"><T k="서명 뒤 내용 변경 표시" /></p>
                </div>
              </div>
            </div>
          </div>

          {/* 작동 방식 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/cert/icons/blockchain-anchor.svg" alt={tAttr('블록체인 앵커')} width={24} height={24} />
              <T k="작동 방식" />
            </h3>
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold text-emerald-700">1</div>
                <div>
                  <p className="text-sm font-bold text-gray-900"><T k="키 생성 (직원 본인)" /></p>
                  <p className="text-xs text-gray-500"><T k="직원이 「내 설정 → 내 전자인증서」에서 키를 생성합니다. 개인키는 브라우저(IndexedDB)에 PIN으로 암호화 저장되며, 공개키만 서버에 등록됩니다. 키 생성 즉시 인증서가 활성화됩니다." /></p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold text-emerald-700">2</div>
                <div>
                  <p className="text-sm font-bold text-gray-900"><T k="문서 서명 (진료 중)" /></p>
                  <p className="text-xs text-gray-500"><T k="진료기록·퇴원요약·조제·검사 작업지·병리 보고서에서 「전자서명」 → 서버가 저장된 문서 내용으로 해시를 계산 → PIN·생체인증으로 그 해시에 서명 → 서버가 지금 내용의 해시와 대조한 뒤 기록합니다. 인증서가 없으면 기존 방식(이름 기록)으로 서명됩니다." /></p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold text-emerald-700">3</div>
                <div>
                  <p className="text-sm font-bold text-gray-900"><T k="내부 원장 앵커링 (자동)" /></p>
                  <p className="text-xs text-gray-500"><T k="서명된 문서 해시들을 모아 Merkle 트리를 만들고 루트를 내부 원장에 기록합니다. 해시마다 루트까지의 증명을 남깁니다. 외부 블록체인에는 아직 기록하지 않습니다(연동 전)." /></p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold text-emerald-700">4</div>
                <div>
                  <p className="text-sm font-bold text-gray-900"><T k="검증 (직원)" /></p>
                  <p className="text-xs text-gray-500"><T k="서명 검증은 서명값을 인증서 공개키로 확인하고, 서명한 해시가 지금 문서 내용과 같은지를 따로 표시합니다. 2026-10-13 이전 서명은 문서 제목 문자열에 서명돼 내용과 맞지 않음으로 나옵니다. 블록체인 기록 상태는 따로 확인해야 합니다." /></p>
                </div>
              </div>
            </div>
          </div>

          {/* 역할별 가이드 */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
              </div>
              <h4 className="text-sm font-bold text-gray-900 mb-2"><T k="의료인" /></h4>
              <ul className="text-xs text-gray-600 space-y-1.5">
                <li><T k="• 「내 설정 → 내 전자인증서」에서 키 생성" /></li>
                <li><T k="• PIN 6자리 설정 (서명할 때마다 입력)" /></li>
                <li><T k="• 키 백업 파일(.hrkb) 안전 보관 필수" /></li>
                <li><T k="• 브라우저 변경 시 키 복원 필요" /></li>
                <li><T k="• 문서 서명 시 자동으로 블록체인 기록" /></li>
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>
              </div>
              <h4 className="text-sm font-bold text-gray-900 mb-2"><T k="환자" /></h4>
              <ul className="text-xs text-gray-600 space-y-1.5">
                <li><T k="• 환자 포털에서 본인인증 후 키 생성" /></li>
                <li><T k="• 동의서에 전자서명 (수술/검사/입원)" /></li>
                <li><T k="• 진단서/소견서 수령 확인 서명" /></li>
                <li><T k="• 발급 문서를 포털에서 안전하게 열람" /></li>
                <li><T k="• 모든 서명이 블록체인에 기록" /></li>
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <h4 className="text-sm font-bold text-gray-900 mb-2"><T k="관리자" /></h4>
              <ul className="text-xs text-gray-600 space-y-1.5">
                <li><T k="• 전체 인증서 현황 모니터링" /></li>
                <li><T k="• 퇴직/보안사고 시 인증서 폐기" /></li>
                <li><T k="• PIN 정책/알고리즘 설정" /></li>
                <li><T k="• 감사 로그 조회 (서명/폐기 이력)" /></li>
                <li><T k="• 블록체인 앵커링 상태 확인" /></li>
                <li><T k="• ⚠ 관리자도 직원의 개인키 접근 불가" /></li>
              </ul>
            </div>
          </div>

          {/* 서명 대상 문서 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4"><T k="서명 대상 문서" /></h3>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="문서 유형" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="의료인 서명" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="환자 서명" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="다중 서명" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="관련 법률" /></th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { doc: '진료기록 (SOAP)', staff: '담당의', patient: '-', multi: '-', law: '의료법 22조' },
                    { doc: '동의서 (수술/검사)', staff: '담당의 + 확인자(선택)', patient: '환자/보호자(필수)', multi: '2~4인 + 시스템', law: '의료법 24조의2' },
                    { doc: '처방전', staff: '처방의', patient: '-', multi: '-', law: '의료법 18조' },
                    { doc: '수술기록 (Op Note)', staff: '집도의 + 마취의', patient: '-', multi: '2인', law: '의료법 22조' },
                    { doc: '퇴원요약', staff: '담당의', patient: '퇴원확인', multi: '2인', law: '의료법 22조' },
                    { doc: '진단서/소견서', staff: '발급 의사', patient: '수령확인', multi: '2인', law: '의료법 17조' },
                    { doc: '검사결과 보고', staff: '판독의/검사자', patient: '-', multi: '-', law: '의료법 22조' },
                    { doc: '조제 확인', staff: '약사', patient: '-', multi: '-', law: '약사법 23조' },
                  ].map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-4 py-2 font-medium text-gray-900 text-xs"><T k={r.doc} /></td>
                      <td className="px-4 py-2 text-xs text-gray-600"><T k={r.staff} /></td>
                      <td className="px-4 py-2 text-xs text-gray-600"><T k={r.patient} /></td>
                      <td className="px-4 py-2 text-xs"><span className={`whitespace-nowrap ${r.multi !== '-' ? 'text-blue-600 font-medium' : 'text-gray-400'}`}><T k={r.multi} /></span></td>
                      {/* 🔴 법령 표기는 번역 대상이 아니다(법령명·조문은 원문이 정본) — 한국어 그대로 */}
                      <td className="px-4 py-2 text-xs text-gray-400">{r.law}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 보안 아키텍처 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/cert/icons/fingerprint.svg" alt={tAttr('보안')} width={24} height={24} />
              <T k="보안 아키텍처" />
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-700 mb-2"><T k="개인키 보호" /></p>
                <ul className="text-[11px] text-gray-600 space-y-1">
                  <li><T k="• 브라우저 Web Crypto API로 생성" /></li>
                  <li><T k="• AES-256-GCM + PIN(PBKDF2 600K)으로 암호화" /></li>
                  <li><T k="• IndexedDB에 암호화 상태로 저장" /></li>
                  <li><T k="• Same-Origin 정책으로 XSS 방어" /></li>
                  <li><T k="• 서버로 전송하지 않음 (Zero-Knowledge)" /></li>
                </ul>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-700 mb-2"><T k="PIN 보안" /></p>
                <ul className="text-[11px] text-gray-600 space-y-1">
                  <li><T k="• PIN 5회 실패 → 10분 잠금" /></li>
                  <li><T k="• PIN 10회 실패 → 인증서 자동 정지" /></li>
                  <li><T k="• 서버 측 실패 횟수 추적 (브라우저 우회 방지)" /></li>
                  <li><T k="• 정지된 인증서는 관리자만 복원 가능" /></li>
                </ul>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-700 mb-2"><T k="블록체인 앵커링" /></p>
                <ul className="text-[11px] text-gray-600 space-y-1">
                  <li><T k="• Merkle Tree로 배치 처리 (1,000건 = 1 Tx)" /></li>
                  <li><T k="• 각 서명에 Merkle Proof 저장 → 개별 검증 가능" /></li>
                  <li><T k="• 타임스탬프 부인 방지" /></li>
                  <li><T k="• Phase 1: 내부 Merkle, Phase 2: 퍼블릭 체인" /></li>
                </ul>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-700 mb-2"><T k="키 분실 대응" /></p>
                <ul className="text-[11px] text-gray-600 space-y-1">
                  <li><T k="• .hrkb 백업 파일 + PIN으로 복원" /></li>
                  <li><T k="• 백업 없이 브라우저 초기화 → 새 키 생성" /></li>
                  <li><T k="• 새 키 생성 시 기존 인증서 자동 폐기" /></li>
                  <li><T k="• 기존 서명은 이전 공개키로 계속 검증 가능" /></li>
                </ul>
              </div>
            </div>
          </div>

          {/* FAQ */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4"><T k="자주 묻는 질문" /></h3>
            <div className="space-y-3">
              {[
                { q: '인증서를 발급하면 바로 사용할 수 있나요?', a: '네, 키 생성 즉시 인증서가 활성화됩니다. 관리자 승인이나 갱신은 필요 없습니다.' },
                { q: '다른 컴퓨터에서도 서명할 수 있나요?', a: '키 백업 파일(.hrkb)을 가지고 있으면 다른 브라우저에서 복원하여 사용할 수 있습니다. 백업 파일이 없으면 새 키를 생성해야 합니다.' },
                { q: '인증서에 유효기간이 있나요?', a: '아니요, 블록체인 자체 인증서는 무기한입니다. 키를 폐기하거나 새로 생성하기 전까지 계속 유효합니다.' },
                { q: '관리자가 직원의 서명을 대신할 수 있나요?', a: '아니요, 개인키는 직원 본인의 브라우저에만 있으므로 관리자도 접근할 수 없습니다. 관리자는 인증서 폐기/정지만 가능합니다.' },
                { q: '인증서 없이도 문서에 서명할 수 있나요?', a: '네, 인증서가 없으면 기존 방식(이름 기록)으로 서명됩니다. 단, 블록체인 검증은 불가능합니다.' },
                { q: '직원이 퇴직하면 어떻게 되나요?', a: '관리자가 해당 직원의 인증서를 폐기합니다. 퇴직 전에 서명한 문서는 계속 유효합니다 (서명 시점이 폐기 전이므로).' },
                { q: 'PIN을 잊어버리면 어떻게 하나요?', a: 'PIN은 복구할 수 없습니다. 새 키를 생성하면 됩니다 (기존 인증서 자동 폐기). 기존 서명은 유효합니다.' },
              ].map((faq, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4">
                  <p className="text-sm font-bold text-gray-900 mb-1">Q. <T k={faq.q} /></p>
                  <p className="text-xs text-gray-600">A. <T k={faq.a} /></p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
