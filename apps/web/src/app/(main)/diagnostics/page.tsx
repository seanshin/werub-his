'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DIAGNOSTIC_TEST_TYPES,
  DIAGNOSTIC_CONCLUSIONS,
  diagnosticMeasurementFields,
  diagnosticTestLabel,
  DIAGNOSTIC_TEST_TRANSITIONS,
  DIAGNOSTIC_TEST_REASON_REQUIRED,
} from '@hospital-run/shared';
import { apiClient, ApiError } from '@/lib/api-client';
import StatusBadge from '@/components/ui/StatusBadge';
import { useHasRole } from '@/hooks/use-admin-write';
import PatientSelector from '@/components/ui/PatientSelector';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';

// 🔴 종류 목록은 shared 정본 하나 — 종전엔 이 파일에만 `TABS`(9종)와 `TEST_TYPES`(11종·이름 다름)
//    두 벌이 있었고 서버·보드까지 합쳐 **네 벌**이 갈라져 있었다.
const TABS = [{ code: '', label: '전체' }, ...DIAGNOSTIC_TEST_TYPES.map(t => ({ code: t.code, label: t.shortLabel }))];

// 상태 라벨·색은 shared `DIAGNOSTIC_TEST_STATUS_LABEL` + `<StatusBadge domain="diagnosticTest">` 하나 — 로컬 표를 두지 않는다
const CONCLUSION_STYLE: Record<string, string> = {
  NORMAL: 'text-emerald-600', ABNORMAL: 'text-red-600', BORDERLINE: 'text-amber-600',
};
const CONCLUSION_LABEL: Record<string, string> = Object.fromEntries(
  DIAGNOSTIC_CONCLUSIONS.map(c => [c.code, c.label]),
);

const TEST_TYPES = DIAGNOSTIC_TEST_TYPES;

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return '-';
  return kdate(dt, 'datetimeShort');
}

interface DiagnosticTest {
  id: string;
  testType: string;
  testName: string;
  status: string;
  conclusion?: string;
  findings?: string;
  impression?: string;
  measurements?: Record<string, unknown> | null;
  requestNote?: string | null;
  statusReason?: string | null;
  statusChangedAt?: string | null;
  scheduledAt?: string;
  performedAt?: string;
  reportedAt?: string;
  createdAt?: string;
  patient?: { familyName: string; givenName: string; mrn?: string };
  requestedByUser?: { familyName: string; givenName: string };
  performedByUser?: { familyName: string; givenName: string };
  interpretedByUser?: { familyName: string; givenName: string };
}

interface DiagnosticTestListResponse {
  data: DiagnosticTest[];
}

export default function DiagnosticsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['diagnostic-tests', activeTab],
    queryFn: () => apiClient.get<{ data: DiagnosticTest[] }>(`/api/v1/diagnostic-tests${activeTab ? `?testType=${activeTab}` : ''}`),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const _testsRaw = data?.data;
  const allTests: DiagnosticTest[] = Array.isArray(_testsRaw) ? _testsRaw : (_testsRaw as DiagnosticTestListResponse | undefined)?.data ?? [];
  // '대기' 버킷은 두 상태(ORDERED+SCHEDULED)의 합 — 종전 'wait' 리터럴 필터는 어느 상태와도
  // 일치하지 않아 "대기 43건" 버튼을 누르면 목록이 0건이 됐다(P2: KPI > 목록).
  const tests = statusFilter === 'wait' ? allTests.filter(t => t.status === 'ORDERED' || t.status === 'SCHEDULED')
    : statusFilter ? allTests.filter(t => t.status === statusFilter) : allTests;

  const ordered = allTests.filter(t => t.status === 'ORDERED' || t.status === 'SCHEDULED').length;
  const inProgress = allTests.filter(t => t.status === 'IN_PROGRESS').length;
  const completed = allTests.filter(t => t.status === 'COMPLETED').length;
  // 보류는 끝난 것이 아니다 — 대기·진행·완료 어디에도 세지 않으면 멈춘 검사가 화면에서 사라진다
  const onHold = allTests.filter(t => t.status === 'ON_HOLD').length;

  const selected = allTests.find(t => t.id === selectedId);

  return (
    <div className="flex gap-0 h-[calc(100vh-80px)]">
      {/* 좌측: 목록 */}
      <div className={`${selected || showOrder ? 'w-[55%]' : 'w-full'} transition-all overflow-auto`}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold text-gray-900"><T k="기초검사" /></h2>
            <p className="text-sm text-gray-500 mt-1"><T k="생리기능검사 의뢰 · 대기 · 결과 관리" /></p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setStatusFilter(statusFilter === 'wait' ? '' : 'wait')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors
                ${statusFilter === 'wait' ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
              대기 {ordered}건
            </button>
            <button onClick={() => setStatusFilter(statusFilter === 'IN_PROGRESS' ? '' : 'IN_PROGRESS')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors
                ${statusFilter === 'IN_PROGRESS' ? 'bg-amber-100 border-amber-200 text-amber-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
              진행 {inProgress}건
            </button>
            <button onClick={() => setStatusFilter(statusFilter === 'COMPLETED' ? '' : 'COMPLETED')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors
                ${statusFilter === 'COMPLETED' ? 'bg-emerald-100 border-emerald-200 text-emerald-700' : 'bg-emerald-50 border-emerald-100 text-emerald-700'}`}>
              완료 {completed}건
            </button>
            <button onClick={() => setStatusFilter(statusFilter === 'ON_HOLD' ? '' : 'ON_HOLD')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors
                ${statusFilter === 'ON_HOLD' ? 'bg-orange-100 border-orange-200 text-orange-700' : 'bg-orange-50 border-orange-100 text-orange-700'}`}>
              <Tf k="보류 {건수}건" params={{ 건수: onHold }} />
            </button>
            <button onClick={() => { setShowOrder(true); setSelectedId(null); }}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 font-medium shadow-sm">
              <T k="+ 검사 의뢰" />
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 mb-4 bg-gray-100/80 p-1 rounded-xl w-fit">
          {TABS.map(tab => (
            <button key={tab.code} onClick={() => setActiveTab(tab.code)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeTab === tab.code ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <T k={tab.label} />
            </button>
          ))}
        </div>

        {/* Test List */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-8">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="의뢰의" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]"><T k="예정일" /></th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 w-[90px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="결론" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : !tests.length ? (
                <tr><td colSpan={9} className="py-16 text-center text-gray-400"><T k="검사 내역 없음" /></td></tr>
              ) : (
                tests.map((t: DiagnosticTest, idx: number) => {
                  const isWaiting = t.status === 'ORDERED' || t.status === 'SCHEDULED';
                  return (
                    <tr key={t.id}
                      onClick={() => { setSelectedId(t.id); setShowOrder(false); }}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${
                        t.id === selectedId ? 'bg-blue-50' : 'hover:bg-gray-50/70'
                      }`}>
                      <td className="px-4 py-3 text-xs text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 text-xs whitespace-nowrap">
                        {t.patient?.familyName}{t.patient?.givenName}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs"><LabTerm name={t.testName} /></td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-medium text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">{diagnosticTestLabel(t.testType)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {t.requestedByUser?.familyName}{t.requestedByUser?.givenName ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {t.performedByUser?.familyName}{t.performedByUser?.givenName ?? (isWaiting ? <span className="text-amber-500"><T k="미배정" /></span> : '-')}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                        {formatDateTime(t.scheduledAt ?? t.performedAt ?? null)}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <StatusBadge domain="diagnosticTest" status={t.status} className="text-[10px]" />
                      </td>
                      <td className="px-4 py-3">
                        {t.conclusion ? (
                          <span className={`text-xs font-semibold ${CONCLUSION_STYLE[t.conclusion] ?? ''}`}>{CONCLUSION_LABEL[t.conclusion] ?? t.conclusion}</span>
                        ) : <span className="text-xs text-gray-300">-</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 우측: 상세/의뢰 패널 */}
      {showOrder && (
        <div className="w-[45%] pl-4 overflow-auto">
          <OrderPanel onClose={() => setShowOrder(false)} onCreated={() => { setShowOrder(false); qc.invalidateQueries({ queryKey: ['diagnostic-tests'] }); }} />
        </div>
      )}
      {selected && !showOrder && (
        <div className="w-[45%] pl-4 overflow-auto">
          <DetailPanel test={selected} onClose={() => setSelectedId(null)} onUpdated={() => qc.invalidateQueries({ queryKey: ['diagnostic-tests'] })} />
        </div>
      )}
    </div>
  );
}

// ── 검사 의뢰 패널 ──
function OrderPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const tAttr = useTAttr();
  /** 🔴 기초검사 의뢰는 처방 행위라 서버가 `@Roles(DOCTOR, ADMIN)` — 간호사는 조회·수행 기록만 */
  const canOrder = useHasRole('DOCTOR');
  // 🔴 검사 유형을 미리 골라두지 않는다 — 종전엔 `EKG` 로 시작해 그대로 눌리면 EKG 가 의뢰됐다.
  const [form, setForm] = useState({ patientId: '', testType: '', testName: '', requestNote: '' });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/diagnostic-tests', {
      // 🔴 DTO 필드명을 명시한다. 스프레드로 보내면 전역 whitelist 가 DTO 에 없는 키를 조용히 지운다.
      patientId: form.patientId,
      testType: form.testType,
      testName: form.testName,
      requestNote: form.requestNote.trim() || undefined,
    }),
    onSuccess: onCreated,
  });

  const handleTypeChange = (code: string) => {
    const info = TEST_TYPES.find(t => t.code === code);
    setForm({ ...form, testType: code, testName: info?.name ?? code });
  };

  return (
    <div className="bg-white rounded-2xl border shadow-sm sticky top-0">
      <div className="px-5 py-4 border-b flex items-center justify-between bg-indigo-50/50">
        <div>
          <h3 className="text-base font-bold text-gray-900"><T k="검사 의뢰" /></h3>
          <p className="text-[11px] text-gray-500 mt-0.5"><T k="생리기능검사 의뢰서 작성" /></p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="p-5 space-y-5">
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1.5"><T k="1. 환자 선택" /></label>
          <PatientSelector
            value={form.patientId}
            onChange={(id) => setForm({ ...form, patientId: id })}
            context="diagnostics"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1.5"><T k="2. 검사 유형" /></label>
          <div className="grid grid-cols-2 gap-1.5">
            {TEST_TYPES.map(t => (
              <button key={t.code} type="button" onClick={() => handleTypeChange(t.code)}
                className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                  form.testType === t.code
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}>
                <span className="font-medium">{t.name}</span>
                <span className="text-[10px] text-gray-400 ml-1">({t.category})</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1.5"><T k="3. 검사명" /></label>
          <input value={form.testName} onChange={e => setForm({ ...form, testName: e.target.value })}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1.5"><T k="4. 의뢰 메모" /> <span className="text-gray-400 font-normal"><T k="(선택)" /></span></label>
          <textarea value={form.requestNote} onChange={e => setForm({ ...form, requestNote: e.target.value })}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300" rows={2} placeholder={tAttr('특이사항, 금식 여부, 알레르기 등')} />
        </div>
        {canOrder && <button onClick={() => createMut.mutate()} disabled={!form.patientId || !form.testType || !form.testName || createMut.isPending}
          className="w-full py-3 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 disabled:opacity-50 font-semibold shadow-sm transition-colors">
          <T k={createMut.isPending ? '의뢰 중...' : '검사 의뢰'} />
        </button>}
      </div>
    </div>
  );
}

// ── 검사 상세 패널 ──
function DetailPanel({ test, onClose, onUpdated }: { test: DiagnosticTest; onClose: () => void; onUpdated: () => void }) {
  const tAttr = useTAttr();
  const isWaiting = test.status === 'ORDERED' || test.status === 'SCHEDULED';
  const isInProgress = test.status === 'IN_PROGRESS';
  const isCompleted = test.status === 'COMPLETED';

  const [findings, setFindings] = useState(test.findings ?? '');
  const [impression, setImpression] = useState(test.impression ?? '');
  // 🔴 결론의 초기값은 **미선택**이다. 종전엔 `'NORMAL'` 로 시작해, 결론을 건드리지 않고
  //    저장하면 판독하지 않은 검사가 "정상"으로 기록됐다(쓰기 폼 기본값 규약).
  const [conclusion, setConclusion] = useState(test.conclusion ?? '');

  const performMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/diagnostic-tests/${test.id}/perform`, {}),
    onSuccess: onUpdated,
  });

  const reportMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/diagnostic-tests/${test.id}/report`, { findings, impression, conclusion }),
    onSuccess: onUpdated,
  });

  return (
    <div className="bg-white rounded-2xl border shadow-sm sticky top-0">
      {/* 헤더 */}
      <div className="px-5 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <StatusBadge domain="diagnosticTest" status={test.status} className="text-[10px]" />
              <h3 className="text-lg font-bold text-gray-900"><LabTerm name={test.testName} /></h3>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {test.patient?.familyName}{test.patient?.givenName} · {test.patient?.mrn ?? ''} · {test.testType}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
        </div>
      </div>

      <div className="p-5 space-y-4 text-sm">
        {/* 검사 정보 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-slate-50 rounded-lg px-4 py-3 border">
          <InfoRow label="의뢰의" value={test.requestedByUser ? `${test.requestedByUser.familyName}${test.requestedByUser.givenName}` : '-'} />
          <InfoRow label="의뢰일" value={formatDateTime(test.createdAt)} />
          <InfoRow label="담당 기사" value={test.performedByUser ? `${test.performedByUser.familyName}${test.performedByUser.givenName}` : tAttr('미배정')} warn={!test.performedByUser && isWaiting} />
          <InfoRow label="예정일" value={formatDateTime(test.scheduledAt)} />
          <InfoRow label="시행일" value={formatDateTime(test.performedAt)} />
          <InfoRow label="판독일" value={formatDateTime(test.reportedAt)} />
          {test.interpretedByUser && <InfoRow label="판독의" value={`${test.interpretedByUser.familyName}${test.interpretedByUser.givenName}`} />}
        </div>

        {test.requestNote && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
            <p className="text-[10px] text-amber-700 font-semibold uppercase mb-0.5"><T k="의뢰 메모" /></p>
            <p className="text-xs text-amber-900 whitespace-pre-wrap">{test.requestNote}</p>
          </div>
        )}

        {/* 보류·취소 — 전이표는 shared 정본(서버 검증과 같은 표) */}
        <StatusActions test={test} onUpdated={onUpdated} />

        {/* 워크플로우 타임라인 */}
        <div>
          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="워크플로우" /></h4>
          <div className="flex items-center gap-0">
            {['ORDERED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].map((s, i) => {
              const done = ['ORDERED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].indexOf(test.status) >= i;
              const current = test.status === s;
              return (
                <div key={s} className="flex items-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                    current ? 'border-indigo-500 bg-indigo-500 text-white' :
                    done ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
                    'border-gray-200 bg-gray-50 text-gray-400'
                  }`}>{i + 1}</div>
                  {i < 3 && <div className={`w-8 h-0.5 ${done ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
                </div>
              );
            })}
          </div>
          <div className="flex gap-0 mt-1">
            {['의뢰', '예약', '시행', '완료'].map((label, i) => (
              <div key={i} className="text-[9px] text-gray-400 text-center" style={{ width: i < 3 ? 'calc(25% + 4px)' : '25%' }}>
                <T k={label} /></div>
            ))}
          </div>
        </div>

        {/* 대기 중 → 검사 시작 버튼 */}
        {isWaiting && (
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
            <p className="text-xs text-blue-700 mb-2 font-medium"><T k="대기 순서: 이 환자의 검사가 아직 시작되지 않았습니다." /></p>
            <button onClick={() => performMut.mutate()} disabled={performMut.isPending}
              className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
              <T k={performMut.isPending ? '처리 중...' : '검사 시작 (IN_PROGRESS)'} />
            </button>
          </div>
        )}

        {/* 진행 중 → 결과 입력 */}
        {isInProgress && (
          <div className="space-y-3">
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide"><T k="결과 입력" /></h4>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1"><T k="소견 (Findings)" /></label>
              <textarea value={findings} onChange={e => setFindings(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" rows={4}
                placeholder="Normal sinus rhythm, HR 72bpm, axis normal. No ST-T changes..." />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1"><T k="판독 소견 (Impression)" /></label>
              <textarea value={impression} onChange={e => setImpression(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" rows={2}
                placeholder={tAttr('정상 심전도 소견')} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1"><T k="결론" /></label>
              <select value={conclusion} onChange={e => setConclusion(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">{tAttr('선택 안 함')}</option>
                {DIAGNOSTIC_CONCLUSIONS.map(c => <option key={c.code} value={c.code}>{tAttr(c.label)}</option>)}
              </select>
            </div>
            <button onClick={() => reportMut.mutate()} disabled={!findings || !conclusion || reportMut.isPending}
              className="w-full py-2.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium">
              <T k={reportMut.isPending ? '저장 중...' : '판독 완료'} />
            </button>
            {!conclusion && <p className="text-[11px] text-gray-400"><T k="결론을 선택해야 판독을 마칠 수 있습니다(기본값 없음)." /></p>}
            <p className="text-[11px] text-gray-400">
              <T k="검사값(측정 항목)은 기초검사 워크스테이션에서 항목별로 입력합니다 — 여기서는 서술 소견만 기록합니다." />
            </p>
          </div>
        )}

        {/* 기록된 검사값(측정 항목) — 상태와 무관하게 있으면 보여준다 */}
        {test.measurements && Object.keys(test.measurements).length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="검사값" /></h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-white rounded-lg px-4 py-3 border">
              {(() => {
                const fields = diagnosticMeasurementFields(test.testType);
                const m = test.measurements ?? {};
                // 정본 항목 순서로 먼저, 정본에 없는 키(장비별 항목)는 뒤에 — **버리지 않는다**
                const known = fields.filter(f => m[f.key] !== undefined && m[f.key] !== null);
                const extra = Object.keys(m).filter(k => !fields.some(f => f.key === k));
                return (
                  <>
                    {known.map(f => (
                      <div key={f.key} className="flex items-baseline gap-1 text-xs">
                        <span className="text-gray-500 min-w-[92px]">{f.label}</span>
                        <span className="font-medium text-gray-900">{String(m[f.key])}</span>
                        {f.unit && <span className="text-gray-400">{f.unit}</span>}
                      </div>
                    ))}
                    {extra.map(k => (
                      <div key={k} className="flex items-baseline gap-1 text-xs">
                        <span className="text-gray-400 min-w-[92px]">{k}</span>
                        <span className="font-medium text-gray-700">{String(m[k])}</span>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* 완료된 검사 결과 표시 */}
        {isCompleted && (
          <div className="space-y-3">
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide"><T k="검사 결과" /></h4>
            <div className={`rounded-lg p-4 border ${
              test.conclusion === 'NORMAL' ? 'bg-emerald-50 border-emerald-200' :
              test.conclusion === 'ABNORMAL' ? 'bg-red-50 border-red-200' :
              test.conclusion === 'BORDERLINE' ? 'bg-amber-50 border-amber-200' :
              'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {/* 🔴 결론이 없는데 'Borderline' 으로 단정하지 않는다(이진 삼항 P10) */}
                <span className={`text-lg font-bold ${test.conclusion ? CONCLUSION_STYLE[test.conclusion] ?? '' : 'text-gray-400'}`}>
                  {test.conclusion === 'NORMAL' ? '✓ ' : test.conclusion === 'ABNORMAL' ? '✗ ' : test.conclusion === 'BORDERLINE' ? '△ ' : ''}
                  <T k={test.conclusion === 'NORMAL' ? '정상'
                    : test.conclusion === 'ABNORMAL' ? '이상'
                    : test.conclusion === 'BORDERLINE' ? '경계'
                    : '결론 미기록'} />
                </span>
              </div>
              {test.findings && (
                <div className="mb-2">
                  <p className="text-[10px] text-gray-500 font-medium uppercase mb-0.5">Findings</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{test.findings}</p>
                </div>
              )}
              {test.impression && (
                <div>
                  <p className="text-[10px] text-gray-500 font-medium uppercase mb-0.5">Impression</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{test.impression}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 상태 전이(취소·보류·보류 해제) ──
// 🔴 버튼은 shared 전이표가 허용한 것만 그린다 — 서버가 거절할 버튼을 보여주지 않는다.
// 🔴 결과가 있는 검사를 취소하면 서버가 409 로 무엇이 남아 있는지 돌려준다 → 확인을 받은 뒤 다시 보낸다(결과는 지워지지 않는다).
// 🔴 오더·청구는 바꾸지 않는다 — 서버가 준 영향 목록을 그대로 보여주고 정정은 담당 부서 몫으로 남긴다.
function StatusActions({ test, onUpdated }: { test: DiagnosticTest; onUpdated: () => void }) {
  const tAttr = useTAttr();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [needsAck, setNeedsAck] = useState(false);
  const [impacts, setImpacts] = useState<{ order: { id: string; status: string | null; found: boolean } | null; billing: { determinable: boolean } } | null>(null);
  const allowed = (DIAGNOSTIC_TEST_TRANSITIONS[test.status] ?? []).filter((s) => s !== 'SCHEDULED' || !!test.scheduledAt);

  const mut = useMutation({
    mutationFn: (vars: { status: string; acknowledgeResult?: boolean }) =>
      apiClient.patch<{ data: { impacts?: typeof impacts } }>(`/api/v1/diagnostic-tests/${test.id}/transition`, {
        status: vars.status,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(vars.acknowledgeResult ? { acknowledgeResult: true } : {}),
      }),
    onSuccess: (res) => {
      setImpacts(res?.data?.impacts ?? null);
      setTarget(null); setReason(''); setNeedsAck(false);
      onUpdated();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'DIAGNOSTIC_HAS_RESULT') setNeedsAck(true);
    },
  });

  const label: Record<string, string> = { ON_HOLD: '보류', CANCELLED: '취소', ORDERED: '보류 해제(의뢰로)', SCHEDULED: '보류 해제(예정으로)' };
  const reasonRequired = target ? DIAGNOSTIC_TEST_REASON_REQUIRED.includes(target) : false;
  const errMsg = mut.error instanceof ApiError && mut.error.code !== 'DIAGNOSTIC_HAS_RESULT' ? mut.error.message : null;

  return (
    <div className="rounded-lg border px-4 py-3 space-y-2">
      {(test.status === 'ON_HOLD' || test.status === 'CANCELLED') && (
        <div className="text-xs">
          <span className="font-semibold text-gray-600"><T k={test.status === 'ON_HOLD' ? '보류 사유' : '취소 사유'} /></span>{' '}
          {/* 사유가 비어 있으면 비어 있다고 말한다 — 이전 구현은 사유를 남기지 않았다 */}
          {test.statusReason ? <span className="text-gray-800">{test.statusReason}</span> : <span className="text-gray-400"><T k="기록된 사유 없음" /></span>}
          {test.statusChangedAt && <span className="text-gray-400"> · {formatDateTime(test.statusChangedAt)}</span>}
        </div>
      )}
      {allowed.length === 0 ? (
        <p className="text-[11px] text-gray-400"><T k="이 상태에서는 더 옮길 수 없습니다" /></p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowed.map((s) => (
            <button key={s} type="button" onClick={() => { setTarget(s); setNeedsAck(false); mut.reset(); }}
              className={`min-h-[44px] px-3 rounded-lg border text-xs font-semibold ${target === s ? 'bg-gray-900 text-white border-gray-900' : s === 'CANCELLED' ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              <T k={label[s] ?? s} />
            </button>
          ))}
        </div>
      )}
      {target && (
        <div className="space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300}
            className="w-full px-3 py-2 border rounded-lg text-sm"
            aria-label={tAttr(reasonRequired ? '사유(필수)' : '사유(선택)')} />
          {needsAck && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
              <p className="font-semibold"><T k="이미 결과가 기록된 검사입니다" /></p>
              <p><T k="취소해도 결과는 지워지지 않지만 완료 검사 추이에서 빠집니다." /></p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={mut.isPending || (reasonRequired && !reason.trim())}
              onClick={() => mut.mutate({ status: target, acknowledgeResult: needsAck })}
              className="min-h-[44px] flex-1 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-40">
              <T k={mut.isPending ? '처리 중...' : needsAck ? '결과가 있음을 확인하고 취소' : '확인'} />
            </button>
            <button type="button" onClick={() => { setTarget(null); setReason(''); setNeedsAck(false); mut.reset(); }}
              className="min-h-[44px] px-4 rounded-lg border text-sm"><T k="닫기" /></button>
          </div>
          {reasonRequired && !reason.trim() && <p className="text-[11px] text-gray-400"><T k="취소·보류는 사유를 입력해야 합니다" /></p>}
          {errMsg && <p className="text-[11px] text-red-600">{errMsg}</p>}
        </div>
      )}
      {impacts && (
        <div className="rounded-lg bg-slate-50 border px-3 py-2 text-[11px] text-slate-700 space-y-0.5">
          <p className="font-semibold"><T k="연결된 기록(자동으로 바꾸지 않음)" /></p>
          <p>
            <T k="오더" />{': '}
            {impacts.order == null ? <T k="연결된 오더 없음" /> : impacts.order.found ? <>{impacts.order.status}</> : <T k="연결된 오더를 찾지 못함" />}
          </p>
          <p><T k="청구" />{': '}<T k="이 검사에 청구가 붙었는지 시스템이 판정할 수 없습니다 — 원무에서 확인하세요" /></p>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-500 min-w-[52px]"><T k={label} /></span>
      <span className={`font-medium ${warn ? 'text-amber-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}
