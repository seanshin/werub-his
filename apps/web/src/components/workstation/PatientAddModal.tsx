'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState, genderText } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { ageOf, localeTimeText } from '@hospital-run/shared';
import { usePrescriberDelegate, PrescriberPicker } from '@/components/prescription/PrescriberDelegate';
import { kstToday } from '@/lib/kst-today';

interface PatientAddModalProps {
  stationType: 'lab' | 'therapy' | 'imaging' | 'diagnostic';
  stationId: string;
  onClose: () => void;
  onAdded: () => void;
}

const BADGE_COLORS: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  purple: 'bg-violet-100 text-violet-700',
};

const THERAPY_TYPES = [
  '운동치료', '도수치료', '열전기치료', '작업치료', '인지치료',
  '언어치료', '삼킴치료', '투석', '항암화학요법', '방사선치료',
];

export function PatientAddModal({ stationType, stationId, onClose, onAdded }: PatientAddModalProps) {
  const tAttr = useTAttr();
  const [search, setSearch] = useState('');
  const [smartData, setSmartData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  // 처방의 후보를 미리 불러오려면 진료(encounter)가 먼저 정해져야 한다 — 제출 시점이 아니라
  // 환자를 고른 시점에 확정한다(기존 DRAFT 재사용, 없을 때만 생성 — 제출 로직과 동일 규칙).
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const delegate = usePrescriberDelegate(encounterId);
  const [pendingInfo, setPendingInfo] = useState<any>(null);
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 초기 로드: 스마트 리스트
  useEffect(() => { loadSmartList(); }, []);

  const loadSmartList = async (q?: string) => {
    setLoading(true);
    try {
      const res = await apiClient.get<any>('/api/v1/workstation/smart-patients', q ? { q } : undefined);
      setSmartData(res?.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  // 검색 debounce
  useEffect(() => {
    const t = setTimeout(() => {
      if (search) loadSmartList(search); else loadSmartList();
      setHighlightIdx(-1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // 전체 환자 리스트 (키보드 내비게이션용)
  const allPatients = [
    ...(smartData?.checkedInPatients ?? []),
    ...(smartData?.checkupPatients ?? []),
    ...(smartData?.admittedPatients ?? []),
  ];
  const searchResults = smartData?.searchResults ?? [];
  const flatList = [...allPatients, ...searchResults];

  // 환자 선택
  const selectPatient = useCallback(async (patient: any) => {
    setSelectedPatient(patient);
    setHighlightIdx(-1);
    try {
      const res = await apiClient.get<any>(`/api/v1/workstation/patient/${patient.id}/pending-orders`, { stationId });
      setPendingInfo(res?.data);
    } catch { setPendingInfo(null); }
  }, [stationId]);

  // 키보드 내비게이션
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (selectedPatient) return;
    if (flatList.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(prev => Math.min(prev + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && flatList[highlightIdx]) {
      e.preventDefault();
      selectPatient(flatList[highlightIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [selectedPatient, flatList, highlightIdx, selectPatient, onClose]);

  // 하이라이트 스크롤
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  /**
   * 🔴 나이 정본은 shared `ageOf` 다 — 화면이 자기 계산을 갖지 않는다.
   *
   * 종전 이 자리는 `Math.floor((Date.now() - dob) / (365.25 * 86400000))` 근사였다.
   * 윤년 보정을 평균으로 뭉개기 때문에 **생일 경계에서 한 살 어긋난다**(BE 32곳이 같은 병이라
   * 2026-08 에 `ageOf` 로 통일했다 — 소아 용량·수가 연령가산·방사선이 읽는 값이다).
   * 또 유효하지 않은 생년월일에 `'-'` 를 돌려주고 호출부가 `세` 를 붙여 **"-세"** 로 찍혔다.
   * 모르는 값은 `null` → "나이 미상"으로 말한다(0세는 신생아라는 다른 사실이다).
   */
  const ageText = (dob: string | Date | null | undefined) => {
    const a = ageOf(dob);
    return a == null ? '나이 미상' : `${a}세`;
  };

  /** 환자 선택 시 진료 확정 — 기존 DRAFT 재사용, 없을 때만 생성 */
  const resolveEncounter = useCallback(async (patientId: string): Promise<string | undefined> => {
    const encRes = await apiClient.get<any>('/api/v1/encounters', { patientId, status: 'DRAFT', limit: '1' });
    const found = encRes?.data?.[0]?.id as string | undefined;
    if (found) return found;
    const newEnc = await apiClient.post<any>('/api/v1/encounters', { patientId, visitType: 'OUTPATIENT' });
    return newEnc?.data?.id as string | undefined;
  }, []);

  useEffect(() => {
    if (!selectedPatient) { setEncounterId(null); return; }
    let alive = true;
    resolveEncounter(selectedPatient.id)
      .then((id) => { if (alive) setEncounterId(id ?? null); })
      .catch(() => { if (alive) setEncounterId(null); });
    return () => { alive = false; };
  }, [selectedPatient, resolveEncounter]);

  /** 치료 모드 — 유형 버튼으로 고른 값만 치료 유형이다(자유 입력칸 없음) */
  const therapyTypeChosen = THERAPY_TYPES.includes(instructions);
  const handleSubmit = async () => {
    if (!selectedPatient) return;
    setSubmitting(true);
    try {
      const encId = encounterId ?? (await resolveEncounter(selectedPatient.id));
      if (!encId) throw new Error('Encounter 생성 실패');
      const encounterId2 = encId;

      if (stationType === 'lab' || stationType === 'imaging' || stationType === 'diagnostic') {
        const type = stationType === 'imaging' ? 'IMAGING' : 'LAB';
        const defaultInst = stationType === 'imaging' ? '워크인 촬영' : stationType === 'diagnostic' ? '워크인 기초검사' : '워크인 검사';
        // 🔴 종전엔 존재하지 않는 EP(`POST /api/v1/prescriptions`)를 불러 **항상 404** 였다.
        //    검사실·영상실·기초검사 워크스테이션(임상병리사·간호사)의 유일한 오더 생성 경로가 죽어 있었다.
        //    정본 EP 로 교체 + 비처방 역할은 책임 처방의 승인 토큰을 동봉한다(서버도 없으면 거부).
        const payload: Record<string, unknown> = { type, instructions: instructions || defaultInst, priority: 'ROUTINE' };
        const auth = await delegate.authorize({ type });
        if (!auth) throw new Error(delegate.error || '지정 처방의 승인을 받지 못했습니다.');
        Object.assign(payload, auth.fields);
        await apiClient.post(`/api/v1/encounters/${encounterId2}/prescriptions`, payload, auth.headers);
      } else {
        // 🔴 (2026-09-15 P3) 치료 모드의 `instructions` 상태는 자유 지시문이 아니라 **고른 치료 유형**이다(유형 버튼만 이 값을 쓴다).
        //    종전엔 아무것도 고르지 않으면 `'운동치료'` 로 채워 오더를 만들었다 — 고르지 않은 치료가 대기열에 섰다.
        //    유형을 고르기 전에는 제출 버튼이 막힌다(아래) · 여기서도 지어낸 기본값을 보내지 않는다.
        if (!therapyTypeChosen) throw new Error(tAttr('치료 유형을 선택하세요'));
        await apiClient.post('/api/v1/workstation/therapy/orders', {
          encounterId: encounterId2, therapyType: instructions, stationId,
          scheduledDate: kstToday(),
          scheduledTime: localeTimeText(new Date(), 'ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
          instructions,
        });
      }
      toast.success(`${selectedPatient.familyName}${selectedPatient.givenName}님 대기열 등록`);
      onAdded(); onClose();
    } catch (err: any) { toast.error(err?.message || '등록 실패'); }
    setSubmitting(false);
  };

  // 검진 진행률 계산
  const checkupProgress = (p: any) => {
    if (p.totalItems == null || p.totalItems === 0) return null;
    const pct = Math.round((p.completedItems / p.totalItems) * 100);
    return { pct, completed: p.completedItems, total: p.totalItems };
  };

  let globalIdx = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-5 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900"><T k="환자 추가" /></h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
          </div>
          <div className="mt-3">
            <input
              ref={inputRef}
              className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
              placeholder={tAttr('환자 이름, 등록번호, 전화번호 검색... (↑↓ 선택, Enter 확인)')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-3" ref={listRef}>
          {/* 선택된 환자 */}
          {selectedPatient ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-bold">{selectedPatient.familyName}</div>
                <div className="flex-1">
                  <div className="font-semibold">{selectedPatient.familyName}{selectedPatient.givenName}</div>
                  <div className="text-xs text-gray-500">{selectedPatient.mrn} · {genderText(selectedPatient.gender)}/{ageText(selectedPatient.dateOfBirth)}</div>
                </div>
                <button onClick={() => { setSelectedPatient(null); setPendingInfo(null); inputRef.current?.focus(); }} className="text-xs text-gray-400 hover:text-gray-600"><T k="변경" /></button>
              </div>

              {/* 기존 오더 경고 */}
              {pendingInfo?.hasExistingOrders && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-sm font-medium text-amber-700"><T k="이미 대기 중인 오더가 있습니다" /></p>
                  <ul className="mt-1 text-xs text-amber-600 space-y-0.5">
                    {pendingInfo.orders.slice(0, 3).map((o: any, i: number) => (
                      <li key={i}>· {o.procedureName} ({o.status === 'ORDERED' ? '대기' : o.status === 'RECEIVED' ? '접수' : '진행중'})</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 검진 정보 */}
              {pendingInfo?.checkupVisit && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-sm font-medium text-emerald-700"><T k="검진 접수 수검자" /></p>
                  <p className="text-xs text-emerald-600 mt-0.5">{pendingInfo.checkupVisit.programName}</p>
                  {pendingInfo.checkupVisit.pendingTests.length > 0 && (
                    <p className="text-xs text-emerald-500 mt-1">대기 검사: {pendingInfo.checkupVisit.pendingTests.slice(0, 5).join(', ')}</p>
                  )}
                </div>
              )}

              {/* 작업 내용 */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">
                  {stationType === 'therapy' ? <T k="치료 유형" /> : stationType === 'imaging' ? <T k="촬영 내용" /> : <T k="검사 내용" />}
                </label>
                {stationType === 'therapy' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {THERAPY_TYPES.map(type => (
                      <button key={type} onClick={() => setInstructions(type)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          instructions === type
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        {type}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input className="w-full border rounded-xl px-3 py-2.5 text-sm"
                    placeholder={stationType === 'imaging' ? tAttr('예: Chest X-ray, Brain MRI') : stationType === 'diagnostic' ? tAttr('예: 심전도, 폐기능') : tAttr('예: CBC, LFT')}
                    value={instructions} onChange={(e) => setInstructions(e.target.value)} />
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="py-8 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div>
          ) : (
            <div className="space-y-3">
              {/* 접수 완료 + 검진 접수 */}
              {allPatients.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">
                    {search ? <T k="매칭된 환자" /> : <T k="오늘 접수/검진 환자" />}
                  </p>
                  <div className="space-y-0.5">
                    {allPatients.map((p: any) => {
                      const idx = globalIdx++;
                      const progress = checkupProgress(p);
                      return (
                        <button key={p.id + (p.badge ?? '')} data-idx={idx}
                          onClick={() => selectPatient(p)}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition ${
                            idx === highlightIdx
                              ? 'bg-blue-50 border border-blue-200'
                              : 'border border-transparent hover:bg-blue-50 hover:border-blue-200'
                          }`}>
                          <div className="w-9 h-9 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0">{p.familyName}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900 text-sm">{p.familyName}{p.givenName}</span>
                              {p.badge && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap ${BADGE_COLORS[p.badgeColor] ?? 'bg-gray-100'}`}>
                                  {p.badge}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 flex items-center gap-2">
                              <span>{p.mrn}</span>
                              <span>{genderText(p.gender)}/{p.age}세</span>
                              {p.programName && <span className="text-emerald-500">{p.programName}</span>}
                              {p.wardName && <span className="text-violet-500">{p.wardName}</span>}
                            </div>
                            {/* 검진 진행률 바 */}
                            {progress && (
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      progress.pct === 100 ? 'bg-emerald-500' : progress.pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'
                                    }`}
                                    style={{ width: `${progress.pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">{progress.completed}/{progress.total}</span>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 일반 검색 결과 */}
              {searchResults.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5"><T k="기타 검색 결과" /></p>
                  <div className="space-y-0.5">
                    {searchResults.map((p: any) => {
                      const idx = globalIdx++;
                      return (
                        <button key={p.id} data-idx={idx}
                          onClick={() => selectPatient(p)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition ${
                            idx === highlightIdx
                              ? 'bg-blue-50 border border-blue-200'
                              : 'border border-transparent hover:bg-gray-50'
                          }`}>
                          <div className="w-8 h-8 bg-gray-50 text-gray-400 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0">{p.familyName}</div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-700">{p.familyName}{p.givenName}</span>
                            <span className="ml-2 text-xs text-gray-400">{p.mrn} · {genderText(p.gender)}/{p.age}세</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {allPatients.length === 0 && searchResults.length === 0 && search && (
                <EmptyState icon="🔍" title="검색 결과가 없습니다" />
              )}

              {allPatients.length === 0 && !search && (
                <EmptyState icon="🔍" title="오늘 접수된 환자가 없습니다." hint="이름으로 검색해주세요." />
              )}
            </div>
          )}
        </div>

        {/* 책임 처방의 지정 — 비처방 역할(임상병리사·간호사)이 워크인 오더를 넣을 때 필수 */}
        {selectedPatient && (
          <div className="px-5 pb-2 flex-shrink-0">
            <PrescriberPicker
              info={delegate.info}
                infoState={delegate.infoState}
              prescriberId={delegate.prescriberId}
              onSelect={(id) => { delegate.setPrescriberId(id); delegate.reset(); }}
              status={delegate.status}
              error={delegate.error}
              orderSource={delegate.orderSource}
              onOrderSource={delegate.setOrderSource}
              readBackConfirmed={delegate.readBackConfirmed}
              onReadBack={delegate.setReadBackConfirmed}
            />
          </div>
        )}

        {/* 하단 */}
        <div className="px-5 py-4 border-t flex items-center justify-between flex-shrink-0">
          <div className="text-[10px] text-gray-300">
            {!selectedPatient && flatList.length > 0 && <T k="↑↓ 선택 · Enter 확인 · Esc 닫기" />}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
            {selectedPatient && (
              <button onClick={handleSubmit} disabled={submitting || (stationType === 'therapy' && !therapyTypeChosen)}
                title={stationType === 'therapy' && !therapyTypeChosen ? tAttr('치료 유형을 선택하세요') : undefined}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-sm">
                {submitting ? <T k="등록 중..." /> : <T k="대기열에 추가" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
