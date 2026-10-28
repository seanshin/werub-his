'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DIAGNOSTIC_TEST_TYPES,
  DIAGNOSTIC_CONCLUSIONS,
  diagnosticMeasurementFields,
  diagnosticTestLabel,
  type DiagnosticMeasurementField,
} from '@hospital-run/shared';
import { apiClient, ApiError } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, Unit, Duration, genderText } from '@/components/ui/display';
import { pollMs } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';
import StatusBadge from '@/components/ui/StatusBadge';

/**
 * 기초검사 워크스테이션 — 검사를 시행하는 조무사·간호사의 자리.
 *
 * 🔴 착수 전 실측(2026-08-26): 이 화면은 `/api/v1/workstation/station/<diag-*>/queue` 를 불렀는데
 *    그 큐는 `orders` 테이블(department=LAB)을 본다. 기초검사 오더는 `diagnostic_tests` 에 쌓인다.
 *    설정 코드(`ECG`·`EGD`)와 수가코드 마스터의 교집합이 0 이라 **부서 전체 폴백**이 걸려,
 *    심전도·폐기능·내시경·청력·심장 다섯 자리가 전부 **같은 채혈 오더 8건**을 보여주고 있었다.
 *    또 결과 입력은 `lab_results` 로 갔고, 검사 종류별 항목은 문자열로 뭉개져 `measurements` 에
 *    한 건도 남지 않았다(운영 완료 30건 중 측정값 5건 — 전부 시드).
 *
 * 지금은 세 가지를 한 화면에서 한다.
 *   ① 이 자리에서 하는 검사 설정 → `PUT /diagnostic-tests/stations/:id/test-types`
 *   ② 대기 환자              → `GET /diagnostic-tests/stations/:id/queue` (설정된 종류만·폴백 없음)
 *   ③ 검사값 등록            → `PATCH /diagnostic-tests/:id/measurements` · `.../report`
 */

interface Station {
  stationId: string; label: string; department: string | null; location: string | null;
  isActive: boolean; testTypes: string[]; unknownCodes: string[]; configured: boolean;
  /** null = 설정이 없어 셀 수 없다(0 과 다른 사실) */
  waiting: number | null;
}
interface QueueItem {
  id: string; patientId: string; testType: string; testName: string; status: string; priority: string;
  scheduledAt: string | null; performedAt: string | null; createdAt: string;
  roomName: string | null; equipmentName: string | null;
  waitingMinutes: number; targetTatMinutes: number | null; tatOverdue: boolean | null;
  measuredCount: number;
  performedByUser: { familyName: string; givenName: string } | null;
  patient: { id: string; mrn: string; familyName: string; givenName: string; gender: string | null; age: number | null } | null;
}
interface QueueMeta {
  stationId: string; label: string; testTypes: string[]; unknownCodes: string[]; configured: boolean; isActive: boolean;
}

// 🔴 (2026-09-14) 로컬 STATUS_BADGE 표를 지웠다 — 상태 라벨·색은 shared `DIAGNOSTIC_TEST_STATUS_LABEL` + `<StatusBadge domain="diagnosticTest">` 하나(P12)

function errText(e: unknown, fallback: string) {
  // 서버 예외 문장(`error.msg` — 검사값 범위·선택지 위반 등)은 화면 언어로 조립한다(I4) · 없으면 서버 원문
  const m = e instanceof ApiError ? extractErrorMessage(e) : (e as { message?: string })?.message;
  return typeof m === 'string' && m.trim() ? m : fallback;
}

export default function DiagnosticWorkstationPage() {
  const qc = useQueryClient();
  const [stationId, setStationId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [target, setTarget] = useState<QueueItem | null>(null);

  const stationsQ = useQuery({
    queryKey: ['diag-stations'],
    queryFn: () => apiClient.get<{ data: Station[]; meta: { unassignedTestTypes: string[] } }>('/api/v1/diagnostic-tests/stations'),
  });
  const stations = stationsQ.data?.data ?? [];
  const unassigned = stationsQ.data?.meta?.unassignedTestTypes ?? [];
  const active = stationId ?? stations[0]?.stationId ?? null;
  const station = stations.find((s) => s.stationId === active) ?? null;

  const queueQ = useQuery({
    queryKey: ['diag-station-queue', active],
    queryFn: () => apiClient.get<{ data: QueueItem[]; meta: QueueMeta }>(`/api/v1/diagnostic-tests/stations/${active}/queue`),
    enabled: !!active,
    refetchInterval: pollMs('fast'),
  });
  const queue = queueQ.data?.data ?? [];
  const queueMeta = queueQ.data?.meta ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['diag-station-queue'] });
    qc.invalidateQueries({ queryKey: ['diag-stations'] });
  };

  const performMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/diagnostic-tests/${id}/perform`, { stationId: active }),
    onSuccess: () => { invalidate(); toast.success('검사 시작'); },
    onError: (e) => toast.error(errText(e, '검사 시작 실패')),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="기초검사 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {station ? `${station.label}${station.location ? ` · ${station.location}` : ''}` : <T k="자리를 선택하세요" />}
            {station?.configured && <> · 대기 {queue.length}<Unit>건</Unit></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 🔴 이 자리에서 검사를 '의뢰'하지 않는다 — 의뢰는 의사 권한이다(POST /diagnostic-tests).
              종전 '+ 환자 추가' 버튼은 기초검사가 아니라 **검사실(LAB) 처방**을 만들고 있었다. */}
          <a href="/diagnostics" className="px-4 py-2 text-sm text-blue-600 font-medium hover:underline"><T k="검사 의뢰 화면" /></a>
          <button onClick={() => setShowSetup((v) => !v)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50">
            {showSetup ? <T k="설정 닫기" /> : <>⚙ <T k="자리 설정" /></>}
          </button>
        </div>
      </div>

      {/* 자리 탭 */}
      {stationsQ.isError ? (
        <QueryErrorFallback error={stationsQ.error} onRetry={() => stationsQ.refetch()} />
      ) : stationsQ.isLoading ? (
        <div className="h-9 bg-gray-100 rounded-xl animate-pulse w-80" />
      ) : stations.length === 0 ? (
        <EmptyState icon="⚙" title="기초검사 자리가 하나도 등록되지 않았습니다"
          hint="아래 '자리 설정'에서 새 자리를 만들면 그 자리의 대기 목록이 생깁니다." />
      ) : (
        <div className="flex gap-1.5 flex-wrap">
          {stations.map((s) => (
            <button key={s.stationId} onClick={() => { setStationId(s.stationId); setShowSetup(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                s.stationId === active ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              {s.label}
              {/* 🔴 설정이 없으면 `0` 이 아니라 '미설정' — 0 은 "한가하다"는 다른 사실이다 */}
              <span className={`px-1.5 rounded-full text-[10px] ${s.waiting === null ? 'bg-gray-100 text-gray-400' : 'bg-white/70 text-gray-600'}`}>
                {s.waiting === null ? <T k="미설정" /> : s.waiting}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 어느 자리에도 없는 검사 종류 — 워크리스트가 없으면 그 검사는 아무 화면에도 안 뜬다 */}
      {unassigned.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          담당 자리가 지정되지 않은 검사 종류 {unassigned.length}종:{' '}
          <b>{unassigned.map((c) => diagnosticTestLabel(c)).join(', ')}</b>
          {' '}— 이 검사가 의뢰되면 어느 자리의 대기 목록에도 뜨지 않습니다. 설정에서 담당 자리를 지정하세요.
        </div>
      )}

      {showSetup && (
        <StationSetup stations={stations} activeStationId={active} onDone={() => { invalidate(); setShowSetup(false); }} />
      )}

      {/* 대기 목록 */}
      {!showSetup && active && (
        queueQ.isError ? (
          <QueryErrorFallback error={queueQ.error} onRetry={() => queueQ.refetch()} />
        ) : queueQ.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : queueMeta && !queueMeta.configured ? (
          // 🔴 "대기 없음"이라 말하지 않는다 — 설정이 없어 **셀 수 없는** 상태다
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-800 font-semibold"><T k="이 자리에서 어떤 검사를 하는지 아직 설정되지 않았습니다." /></p>
            <p className="text-sm text-gray-500 mt-1"><T k="대기 환자가 없는 것이 아니라, 무엇을 대기로 볼지 정해지지 않아 셀 수 없습니다." /></p>
            {queueMeta.unknownCodes.length > 0 && (
              <p className="text-xs text-amber-700 mt-2">
                기존 설정값 <code>{queueMeta.unknownCodes.join(', ')}</code> 은(는) 검사 종류 어휘에 없어 아무것도 잡지 못합니다.
              </p>
            )}
            <button onClick={() => setShowSetup(true)} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium">
              <T k="지금 설정하기" />
            </button>
          </div>
        ) : queue.length === 0 ? (
          <EmptyState icon="💓" title="대기 중인 검사가 없습니다"
            hint={`이 자리는 ${(queueMeta?.testTypes ?? []).map((t) => diagnosticTestLabel(t)).join(', ')} 을(를) 담당합니다.`} />
        ) : (
          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.id} className={`bg-white border rounded-xl p-4 ${item.priority === 'STAT' ? 'border-red-300 bg-red-50/30' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    {item.priority === 'STAT' && <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded">STAT</span>}
                    {item.priority === 'URGENT' && <span className="px-2 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded"><T k="응급" /></span>}
                    <div>
                      <span className="font-semibold">{item.patient?.familyName}{item.patient?.givenName}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {genderText(item.patient?.gender)}/{item.patient?.age ?? '-'}세 · {item.patient?.mrn ?? '-'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 font-medium"><LabTerm name={item.testName} /></span>
                    <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{diagnosticTestLabel(item.testType)}</span>
                    <StatusBadge domain="diagnosticTest" status={item.status} className="text-[10px]" />
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                  <span><T k="대기" /> <Duration minutes={item.waitingMinutes} dense /></span>
                  {/* 🔴 목표 소요시간이 없으면 초과 여부를 판정하지 않는다(초록도 빨강도 아니다) */}
                  {item.tatOverdue === null
                    ? <span className="text-gray-400"><T k="목표 소요시간 미설정 — 지연 판정 불가" /></span>
                    : item.tatOverdue
                      ? <span className="text-red-600 font-semibold">목표 {item.targetTatMinutes}분 초과</span>
                      : <span className="text-emerald-600">목표 {item.targetTatMinutes}분 이내</span>}
                  {item.measuredCount > 0 && <span className="text-blue-600">검사값 {item.measuredCount}항목 기록됨</span>}
                  {item.performedByUser && <span><T k="담당" /> {item.performedByUser.familyName}{item.performedByUser.givenName}</span>}
                  {item.roomName && <span>{item.roomName}</span>}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  {(item.status === 'ORDERED' || item.status === 'SCHEDULED') && (
                    <button onClick={() => performMut.mutate(item.id)} disabled={performMut.isPending}
                      className="min-h-[44px] px-4 bg-amber-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                      <T k="검사 시작" />
                    </button>
                  )}
                  <button onClick={() => setTarget(item)}
                    className="min-h-[44px] px-4 bg-emerald-600 text-white rounded-xl text-sm font-medium shadow-sm">
                    <T k={item.measuredCount > 0 ? '검사값 이어쓰기' : '검사값 등록'} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {target && (
        <MeasurementModal
          test={target}
          stationId={active}
          onClose={() => setTarget(null)}
          onSaved={() => { invalidate(); setTarget(null); }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ① 자리 설정 — 이 자리에서 무슨 검사를 하는가
// ══════════════════════════════════════════════════════════════

function StationSetup({ stations, activeStationId, onDone }: {
  stations: Station[]; activeStationId: string | null; onDone: () => void;
}) {
  const target = stations.find((s) => s.stationId === activeStationId) ?? null;
  const [selected, setSelected] = useState<string[]>(target?.testTypes ?? []);
  const [label, setLabel] = useState(target?.label ?? '');
  const [location, setLocation] = useState(target?.location ?? '');
  const [creating, setCreating] = useState(false);
  const [newStation, setNewStation] = useState({ stationId: '', label: '', department: '' });
  const [newTypes, setNewTypes] = useState<string[]>([]);

  const saveMut = useMutation({
    mutationFn: () => apiClient.put(`/api/v1/diagnostic-tests/stations/${target!.stationId}/test-types`, {
      testTypes: selected,
      label: label.trim() || undefined,
      location: location.trim() || undefined,
    }),
    onSuccess: () => { toast.success('자리 설정 저장'); onDone(); },
    onError: (e) => toast.error(errText(e, '설정 저장 실패')),
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/diagnostic-tests/stations', {
      stationId: newStation.stationId.trim(),
      label: newStation.label.trim(),
      department: newStation.department.trim(),
      testTypes: newTypes,
    }),
    onSuccess: () => { toast.success('자리 신설'); setCreating(false); setNewStation({ stationId: '', label: '', department: '' }); setNewTypes([]); onDone(); },
    onError: (e) => toast.error(errText(e, '자리 신설 실패')),
  });

  const toggle = (code: string, list: string[], set: (v: string[]) => void) =>
    set(list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  // 이 종류를 이미 담당하는 다른 자리 — 같은 검사가 두 자리에 뜨는 것은 실수일 수 있다(막지는 않는다)
  const ownerOf = (code: string) =>
    stations.filter((s) => s.stationId !== target?.stationId && s.testTypes.includes(code)).map((s) => s.label);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
      <div>
        <h2 className="font-bold text-gray-900"><T k="이 자리에서 시행하는 검사" /></h2>
        <p className="text-xs text-gray-500 mt-0.5">
          <T k="여기서 고른 검사만 이 자리의 대기 목록에 뜹니다. 고르지 않으면 대기 건수를 셀 수 없습니다(0 이 아닙니다)." />
        </p>
      </div>

      {target ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {DIAGNOSTIC_TEST_TYPES.map((t) => {
              const on = selected.includes(t.code);
              const others = ownerOf(t.code);
              return (
                <button key={t.code} type="button" onClick={() => toggle(t.code, selected, setSelected)}
                  className={`text-left px-3 py-2.5 rounded-xl border min-h-[44px] transition ${
                    on ? 'border-amber-300 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-300'}`}>
                      {on ? '✓' : ''}
                    </span>
                    <span className="text-sm font-medium text-gray-800">{t.shortLabel}</span>
                    <span className="text-[10px] text-gray-400">{t.category}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 pl-6">{t.name}</div>
                  {others.length > 0 && (
                    <div className="text-[10px] text-blue-600 mt-0.5 pl-6">이미 {others.join(', ')} 담당</div>
                  )}
                </button>
              );
            })}
          </div>

          {target.unknownCodes.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              기존 설정값 <code>{target.unknownCodes.join(', ')}</code> 은(는) 검사 종류 어휘에 없습니다.
              저장하면 위에서 고른 값으로 교체됩니다.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600"><T k="자리 이름" />
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600"><T k="위치(층·구역)" />
              <input value={location} onChange={(e) => setLocation(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              className="min-h-[44px] px-5 bg-amber-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {saveMut.isPending ? <T k="저장 중…" /> : <><T k="설정 저장" /> ({selected.length}종)</>}
            </button>
            {selected.length === 0 && <span className="text-xs text-gray-500"><T k="하나도 고르지 않으면 이 자리는 대기를 셀 수 없습니다." /></span>}
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500"><T k="설정할 자리를 위에서 선택하세요." /></p>
      )}

      <div className="border-t border-gray-100 pt-4">
        {!creating ? (
          <button onClick={() => setCreating(true)} className="text-sm text-blue-600 font-medium">+ <T k="새 자리 만들기" /></button>
        ) : (
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-800 text-sm"><T k="새 자리" /></h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-gray-600"><T k="자리 ID" />
                <input value={newStation.stationId} onChange={(e) => setNewStation({ ...newStation, stationId: e.target.value })}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
                <span className="text-[10px] text-gray-400"><T k="diag- 로 시작 · 소문자·숫자·하이픈" /></span>
              </label>
              <label className="text-xs text-gray-600"><T k="자리 이름" />
                <input value={newStation.label} onChange={(e) => setNewStation({ ...newStation, label: e.target.value })}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              </label>
              <label className="text-xs text-gray-600"><T k="담당 부서·진료과" />
                <input value={newStation.department} onChange={(e) => setNewStation({ ...newStation, department: e.target.value })}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DIAGNOSTIC_TEST_TYPES.map((t) => (
                <button key={t.code} type="button" onClick={() => toggle(t.code, newTypes, setNewTypes)}
                  className={`px-3 py-1.5 rounded-xl border text-xs ${newTypes.includes(t.code) ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-600'}`}>
                  {t.shortLabel}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !newStation.stationId.trim() || !newStation.label.trim() || !newStation.department.trim() || newTypes.length === 0}
                className="min-h-[44px] px-5 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                <T k={createMut.isPending ? '만드는 중…' : '자리 만들기'} />
              </button>
              <button onClick={() => setCreating(false)} className="min-h-[44px] px-4 text-sm text-gray-500"><T k="취소" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ③ 검사값 등록
// ══════════════════════════════════════════════════════════════

function MeasurementModal({ test, stationId, onClose, onSaved }: {
  test: QueueItem; stationId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const fields = useMemo(() => diagnosticMeasurementFields(test.testType), [test.testType]);

  // 🔴 초기값은 전부 비어 있다. 임상값을 미리 채우면 그것이 그대로 저장된다.
  //    (간호초기평가가 `명료·독립보행·통증0`으로 시작해 실제로 그렇게 저장되던 것과 같은 결함)
  const [values, setValues] = useState<Record<string, string>>({});
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [conclusion, setConclusion] = useState(''); // 미선택
  const [critical, setCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState('');

  const detailQ = useQuery({
    queryKey: ['diag-test-detail', test.id],
    queryFn: () => apiClient.get<{ data: { measurements: Record<string, unknown> | null } }>(`/api/v1/diagnostic-tests/${test.id}`),
  });
  const saved = detailQ.data?.data?.measurements ?? null;

  const entries = useMemo(() => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(values)) {
      const t = v.trim();
      if (t === '') continue; // 미입력은 값이 아니다
      const field = fields.find((f) => f.key === k);
      out[k] = field?.kind === 'number' ? Number(t) : t;
    }
    return out;
  }, [values, fields]);
  const filledCount = Object.keys(entries).length;

  const saveMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/diagnostic-tests/${test.id}/measurements`, {
      measurements: entries,
      stationId: stationId ?? undefined,
    }),
    onSuccess: () => { toast.success(`검사값 ${filledCount}항목 저장`); onSaved(); },
    onError: (e) => toast.error(errText(e, '검사값 저장 실패')),
  });

  const reportMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/diagnostic-tests/${test.id}/report`, {
      findings: findings.trim() || undefined,
      impression: impression.trim() || undefined,
      conclusion,
      measurements: filledCount > 0 ? entries : undefined,
      criticalFlag: critical,
      criticalNote: critical ? (criticalNote.trim() || undefined) : undefined,
    }),
    onSuccess: () => { toast.success('판독 등록 — 검토 대기'); onSaved(); },
    onError: (e) => toast.error(errText(e, '판독 등록 실패')),
  });

  const canReport = conclusion !== '' && findings.trim() !== '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex-shrink-0">
          <h3 className="font-bold text-gray-900"><T k="검사값 등록" /> — <LabTerm name={test.testName} /></h3>
          <p className="text-sm text-gray-500">
            {test.patient?.familyName}{test.patient?.givenName} · {test.patient?.mrn ?? '-'} · {diagnosticTestLabel(test.testType)}
          </p>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {/* 이미 저장된 값 — 이어쓰기임을 밝힌다 */}
          {saved && Object.keys(saved).length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              이미 기록된 검사값 {Object.keys(saved).length}항목이 있습니다. 아래에서 입력한 항목만 갱신되고 나머지는 그대로 남습니다.
            </div>
          )}

          {fields.length === 0 ? (
            // 🔴 빈 항목표를 "잴 것이 없다"로 읽지 않는다
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              이 검사 종류({diagnosticTestLabel(test.testType)})는 정형 측정 항목이 아직 정해져 있지 않습니다. 아래 소견으로 기록하세요.
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-700"><T k="측정값" /></label>
                <span className="text-[11px] text-gray-400">입력 {filledCount}/{fields.length}항목 · 빈칸은 저장되지 않습니다</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {fields.map((f) => (
                  <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} savedValue={saved?.[f.key]}
                    onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1"><T k="소견 (Findings)" /></label>
            <textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1"><T k="판독 소견 (Impression)" /></label>
            <textarea value={impression} onChange={(e) => setImpression(e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5"><T k="결론@판독" /></label>
            <div className="flex gap-2">
              {DIAGNOSTIC_CONCLUSIONS.map((c) => (
                <button key={c.code} type="button" onClick={() => setConclusion(c.code)}
                  className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium border-2 transition ${
                    conclusion === c.code ? 'border-gray-800 bg-gray-800 text-white' : 'bg-white border-gray-200 text-gray-500'
                  }`}>{c.label}</button>
              ))}
            </div>
            {conclusion === '' && <p className="text-[11px] text-gray-400 mt-1"><T k="판독을 마치려면 결론을 선택해야 합니다(기본값 없음)." /></p>}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} className="mt-1" />
            <span>
              <span className="font-medium text-red-700">위험소견</span>
              <span className="text-xs text-gray-500 block">체크하면 의뢰의에게 알림이 발행됩니다.</span>
            </span>
          </label>
          {critical && (
            <input value={criticalNote} onChange={(e) => setCriticalNote(e.target.value)}
              className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm" />
          )}
        </div>

        <div className="px-5 py-4 border-t flex justify-between gap-2 flex-shrink-0 flex-wrap">
          <button onClick={onClose} className="min-h-[44px] px-4 text-sm text-gray-500"><T k="닫기" /></button>
          <div className="flex gap-2">
            <button onClick={() => saveMut.mutate()} disabled={filledCount === 0 || saveMut.isPending}
              className="min-h-[44px] px-4 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-40">
              <T k={saveMut.isPending ? '저장 중…' : '검사값만 저장'} />
            </button>
            <button onClick={() => reportMut.mutate()} disabled={!canReport || reportMut.isPending}
              className="min-h-[44px] px-4 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40">
              {reportMut.isPending ? <T k="등록 중…" /> : <T k="판독까지 등록" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ field, value, savedValue, onChange }: {
  field: DiagnosticMeasurementField; value: string; savedValue?: unknown; onChange: (v: string) => void;
}) {
  const tAttr = useTAttr();
  const step = field.decimals && field.decimals > 0 ? String(1 / Math.pow(10, field.decimals)) : '1';
  const hasSaved = savedValue !== undefined && savedValue !== null && savedValue !== '';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] font-medium text-gray-600">
          {field.label}{field.unit ? <span className="text-gray-400"> ({field.unit})</span> : null}
        </label>
        {hasSaved && <span className="text-[10px] text-blue-600">기록됨: {String(savedValue)}</span>}
      </div>
      {field.kind === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm min-h-[44px]">
          {/* 🔴 첫 선택지를 기본값으로 만들지 않는다 */}
          <option value="">{tAttr('선택 안 함')}</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.kind === 'number' ? (
        <input type="number" inputMode="decimal" step={step} min={field.min} max={field.max}
          value={value} onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm min-h-[44px]" />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm min-h-[44px]" />
      )}
    </div>
  );
}
