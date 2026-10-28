'use client';

/**
 * 직원 혈액·체액 노출 사고(니들스틱) — 신고·본인 이력·감염관리 추적관찰. 2026-08-18.
 *
 * 배경: 이 EP 들은 2026-08-18 프로세스 메모리에서 `StaffExposureIncident` 원장으로 영속화됐지만
 *       **부르는 화면이 없었다.** 서버만 정직해지고 아무도 사고를 신고할 수 없는 상태였다
 *       (규약: "EP 를 만들면 부르는 화면까지가 한 벌").
 *
 * 🔴 이 화면이 지키는 것
 *  - 원환자 감염상태는 **양성/음성/미상 3상**. 미상은 초록도 회색도 아닌 주의색이고 "음성"이라
 *    말하지 않는다. 3상 판정은 서버(`sourceStatus`)만 한다 — 화면이 boolean 을 접지 않는다.
 *  - 0 건은 **"접수된 기록이 없다"**(서버 `zeroMeaning`). "사고가 없다"는 다른 사실이다.
 *  - 조회 실패를 빈 목록으로 삼키지 않는다 — 실패는 `QueryErrorFallback` 으로 실패라고 말한다.
 *  - 본인 이력을 조회할 수 없는 경우(계정↔직원 미연결)는 0 건이 아니라 **'산출 불가'**.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '@/components/ui/StatusBadge';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName, StaffName, Unit, Unknown } from '@/components/ui/display';
import { useHasPermission } from '@/lib/permissions';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import ReportForm from './ReportForm';
import { T, Tf, useTAttr, useTfAttr, Data } from '@/components/ui/i18n-text';
import {
  FOLLOW_UP_BADGE,
  FOLLOW_UP_STATUSES,
  exposureTypeLabel,
  followUpLabel,
  serologyView,
  type SourceStatusView,
} from './staff-exposure-labels';

interface ExposureRow {
  id: string;
  staffId: string;
  occurredAt: string;
  exposureType: string;
  exposureTypeLabel?: string;
  bodyPart: string | null;
  deviceType: string | null;
  place: string | null;
  sourcePatientId: string | null;
  ppeUsed: string | null;
  immediateAction: string | null;
  prophylaxis: string | null;
  followUpStatus: string;
  followUpStatusLabel?: string;
  followUpNotes: string | null;
  reportedAt: string;
  closedAt: string | null;
  sourceStatus?: SourceStatusView;
  /** null = 알려야 할 것이 없음(거짓 경보를 만들지 않는다) */
  sourceStatusNote?: string | null;
  staff?: { id: string; familyName: string; givenName: string; department: string; position: string } | null;
  sourcePatient?: { id: string; mrn: string; familyName: string; givenName: string } | null;
}

interface ExposureList {
  exposures: ExposureRow[];
  /** null = 셀 수 없었다(산출 불가). 0 과 다른 사실이다 */
  totalCount: number | null;
  truncated?: boolean;
  limit?: number;
  summary?: {
    byType: Record<string, number>;
    open: number;
    sourceStatusUnknown: number;
  };
  zeroMeaning: string | null;
  staffLinked?: boolean;
  unavailableReason?: string | null;
}

const API = '/api/v1/infection-control/staff-exposure';

/* ── 혈청 3상 배지 ─────────────────────────────────────────────────────────── */
function SerologyCell({ label, value }: { label: string; value: SourceStatusView[keyof SourceStatusView] | undefined }) {
  const tAttr = useTAttr();
  const v = serologyView(typeof value === 'string' ? value : undefined);
  return (
    <span
      title={tAttr(v.title)}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${v.tone}`}
    >
      <span className="opacity-70">{label}</span>
      <T k={v.label} />
    </span>
  );
}

/* ── 추적관찰 갱신(감염관리 권한) ──────────────────────────────────────────── */
function FollowUpPanel({ row, onDone }: { row: ExposureRow; onDone: () => void }) {
  const [status, setStatus] = useState(row.followUpStatus);
  const [notes, setNotes] = useState('');
  const [prophylaxis, setProphylaxis] = useState('');
  const [serology, setSerology] = useState<Record<'sourceHbv' | 'sourceHcv' | 'sourceHiv', '' | 'NEGATIVE' | 'POSITIVE'>>({
    sourceHbv: '',
    sourceHcv: '',
    sourceHiv: '',
  });
  const [errorText, setErrorText] = useState<string | null>(null);
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { followUpStatus: status };
      if (notes.trim()) body.followUpNotes = notes.trim();
      if (prophylaxis.trim()) body.prophylaxis = prophylaxis.trim();
      // 🔴 '변경 없음'은 **키를 보내지 않는 것**이다 — 보내면 기존 미상이 덮인다
      for (const k of ['sourceHbv', 'sourceHcv', 'sourceHiv'] as const) {
        if (serology[k]) body[k] = serology[k] === 'POSITIVE';
      }
      return apiClient.put(`${API}/${row.id}/follow-up`, body);
    },
    onSuccess: () => {
      setErrorText(null);
      toast.success(tAttr('추적관찰이 갱신됐습니다'));
      qc.invalidateQueries({ queryKey: ['staff-exposure'] });
      onDone();
    },
    onError: (e) => setErrorText(extractErrorMessage(e)),
  });

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
      <p className="mb-3 text-xs font-semibold text-gray-800"><T k="추적관찰 갱신" /></p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`fu-${row.id}`}>
            <T k="추적 상태" />
          </label>
          <select
            id={`fu-${row.id}`}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {FOLLOW_UP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tAttr(followUpLabel(s))}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-gray-400">
            <T k="종결로 바꿀 때만 종결 시각이 기록되고, 재개하면 지워집니다" />
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`px-${row.id}`}>
            <T k="예방조치(PEP·백신)" />
          </label>
          <textarea
            id={`px-${row.id}`}
            rows={2}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={prophylaxis}
            onChange={(e) => setProphylaxis(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`nt-${row.id}`}>
            <T k="추적 메모" />
          </label>
          <textarea
            id={`nt-${row.id}`}
            rows={2}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-gray-600">
          <T k="원환자 검사 결과가 나왔다면 반영합니다" />
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ['sourceHbv', 'HBsAg'],
              ['sourceHcv', 'anti-HCV'],
              ['sourceHiv', 'HIV'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-20 text-[11px] text-gray-500">{label}</span>
              <select
                aria-label={tfAttr('{검사} 결과 반영', { 검사: label })}
                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                value={serology[key]}
                onChange={(e) =>
                  setSerology((s) => ({ ...s, [key]: e.target.value as '' | 'NEGATIVE' | 'POSITIVE' }))
                }
              >
                <option value="">{tAttr('변경 없음')}</option>
                <option value="NEGATIVE">{tAttr('음성')}</option>
                <option value="POSITIVE">{tAttr('양성')}</option>
              </select>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-gray-400">
          🔴 <T k="미상으로 되돌릴 수는 없습니다 — 판명된 결과만 입력하십시오" />
        </p>
      </div>

      {errorText && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <Tf k="갱신되지 않았습니다 — {사유}" params={{ 사유: errorText }} />
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <T k={mutation.isPending ? '저장 중…' : '저장'} />
        </button>
        <button onClick={onDone} className="text-xs text-gray-500 hover:underline">
          <T k="닫기" />
        </button>
      </div>
    </div>
  );
}

/* ── 목록 ──────────────────────────────────────────────────────────────────── */
function ExposureTable({ rows, canManage }: { rows: ExposureRow[]; canManage: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
            <th className="px-3 py-2 font-medium"><T k="발생 시각" /></th>
            <th className="px-3 py-2 font-medium"><T k="유형" /></th>
            <th className="px-3 py-2 font-medium"><T k="피노출 직원" /></th>
            <th className="px-3 py-2 font-medium"><T k="부위·기구·장소" /></th>
            <th className="px-3 py-2 font-medium"><T k="원환자" /></th>
            <th className="px-3 py-2 font-medium"><T k="원환자 감염상태" /></th>
            <th className="px-3 py-2 font-medium"><T k="추적" /></th>
            <th className="px-3 py-2 font-medium"><T k="종결" /></th>
            {canManage && <th className="px-3 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-50 align-top">
              <td className="px-3 py-2 whitespace-nowrap">
                <KDate value={r.occurredAt} mode="datetime" />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <T k={exposureTypeLabel(r.exposureType, r.exposureTypeLabel)} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {/* 🔴 이름을 못 붙였으면 UUID 를 이름처럼 보여주지 않는다 */}
                <StaffName
                  familyName={r.staff?.familyName}
                  givenName={r.staff?.givenName}
                  department={r.staff?.department}
                  role={r.staff?.position}
                />
              </td>
              <td className="px-3 py-2 text-xs text-gray-600">
                {[r.bodyPart, r.deviceType, r.place].filter(Boolean).join(' · ') || (
                  <Unknown kind="UNRECORDED" />
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.sourcePatient ? (
                  <PatientName
                    familyName={r.sourcePatient.familyName}
                    givenName={r.sourcePatient.givenName}
                    mrn={r.sourcePatient.mrn}
                  />
                ) : r.sourcePatientId ? (
                  // 지목은 됐는데 이름을 못 읽은 경우 — '없음'이라고 말하지 않는다
                  <Unknown kind="UNRECORDED" />
                ) : (
                  <span className="text-xs text-amber-700"><T k="무명 노출" /></span>
                )}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  <SerologyCell label="HBV" value={r.sourceStatus?.hbv} />
                  <SerologyCell label="HCV" value={r.sourceStatus?.hcv} />
                  <SerologyCell label="HIV" value={r.sourceStatus?.hiv} />
                </div>
                {/* 🔴 서버가 말할 것이 있을 때만 말한다 — 거짓 경보는 진짜 경보를 죽인다 */}
                {r.sourceStatusNote && (
                  <p className="mt-1 max-w-md text-[11px] leading-snug text-amber-800">
                    {r.sourceStatusNote}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {/* 🔴 StatusBadge 는 스스로 번역한다(`라벨@상태` → 라벨) — 밖에서 감싸면 이중 처리가 된다 */}
                <StatusBadge status={r.followUpStatus} config={FOLLOW_UP_BADGE} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-xs">
                {/* 열려 있으면 '아직 없음' — '-' 로 뭉개면 기록 누락과 구분이 안 된다 */}
                <KDate value={r.closedAt} mode="datetime" unknown="PENDING" />
              </td>
              {canManage && (
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  >
                    <T k={openId === r.id ? '닫기' : '추적 갱신'} />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {canManage &&
            rows
              .filter((r) => r.id === openId)
              .map((r) => (
                <tr key={`${r.id}-panel`}>
                  <td colSpan={9} className="px-3 pb-4">
                    <FollowUpPanel row={r} onDone={() => setOpenId(null)} />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 페이지 ────────────────────────────────────────────────────────────────── */
export default function StaffExposurePage() {
  const canManage = useHasPermission('staff:exposure:manage');
  const tAttr = useTAttr();
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const active: 'mine' | 'all' = canManage ? tab : 'mine';

  const mine = useQuery({
    queryKey: ['staff-exposure', 'mine'],
    queryFn: () => apiClient.get<{ data: ExposureList }>(`${API}/mine`),
  });
  const all = useQuery({
    queryKey: ['staff-exposure', 'all'],
    queryFn: () => apiClient.get<{ data: ExposureList }>(API),
    enabled: canManage,
  });

  const q = active === 'mine' ? mine : all;
  const list = q.data?.data;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="직원 노출 사고" /></h2>
        <p className="mt-1 text-sm text-gray-500">
          <T k="니들스틱·예리물·체액 노출의 접수와 추적관찰 — 산업안전보건법·감염관리 법정기록" />
        </p>
      </div>

      <div className="mb-6">
        <ReportForm onReported={() => setTab('mine')} />
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-gray-50 p-1">
            <button
              onClick={() => setTab('mine')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                active === 'mine' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              <T k="내 노출 이력" />
            </button>
            {canManage && (
              <button
                onClick={() => setTab('all')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  active === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                <T k="전 직원(감염관리)" />
              </button>
            )}
          </div>
          {/* 🔴 탭을 숨기는 것은 UX 배려일 뿐 권한 회수가 아니다 — 실제 차단은 서버(RolesGuard)가 한다 */}
          {!canManage && (
            <span className="text-[11px] text-gray-400">
              <T k="전 직원 이력은 감염관리 권한(staff:exposure:manage)이 있어야 열람할 수 있습니다" />
            </span>
          )}

          {list && list.totalCount != null && (
            <div className="ml-auto flex items-center gap-4 text-xs text-gray-600">
              <Tf k="접수 {건수}" params={{ 건수: <>{list.totalCount}<Unit>건</Unit></> }} />
              {list.summary && (
                <>
                  <Tf className="text-blue-700" k="추적 중 {건수}" params={{ 건수: <>{list.summary.open}<Unit>건</Unit></> }} />
                  {list.summary.sourceStatusUnknown > 0 && (
                    <span
                      className="text-amber-800"
                      title={tAttr('원환자 감염상태가 아직 판명되지 않은 건 — 음성이 아니라 미확인입니다')}
                    >
                      <Tf k="원환자 미상 {건수}" params={{ 건수: <>{list.summary.sourceStatusUnknown}<Unit>건</Unit></> }} />
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 🔴 실패는 빈 목록이 아니라 실패로 */}
        {q.isError ? (
          <QueryErrorFallback error={q.error} onRetry={q.refetch} />
        ) : q.isLoading ? (
          <p className="py-10 text-center text-sm text-gray-400"><T k="불러오는 중…" /></p>
        ) : list?.unavailableReason ? (
          // 🔴 '0 건'이 아니다 — 셀 수 없었다는 사실을 그대로 말한다
          <EmptyState icon="🔒" title="산출 불가" hint={<Data>{list.unavailableReason}</Data>} />
        ) : list && list.exposures.length > 0 ? (
          <>
            <ExposureTable rows={list.exposures} canManage={canManage && active === 'all'} />
            {list.truncated && (
              <Tf className="mt-3 block text-xs text-amber-700" k="최근 {표시}건만 표시했습니다 — 전체 {전체}건 중 일부입니다." params={{ 표시: list.limit, 전체: list.totalCount }} />
            )}
          </>
        ) : (
          // 🔴 서버가 준 zeroMeaning 을 그대로 말한다. "사고가 없다"고 바꿔 말하지 않는다.
          <EmptyState
            icon="📄"
            title={list?.zeroMeaning ? <Data>{list.zeroMeaning}</Data> : '접수된 기록을 확인할 수 없습니다'}
          />
        )}
      </div>
    </div>
  );
}
