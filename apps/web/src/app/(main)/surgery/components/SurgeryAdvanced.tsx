'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit, Duration } from '@/components/ui/display';
import { SurgicalChecklistPanel } from './SurgicalChecklistPanel';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';
import { anesthesiaText, ANESTHESIA_LABEL } from '@hospital-run/shared';
import { UNMEASURED_LABEL } from '@/lib/vital-flags';
import { VitalSignsGrid } from '@/components/vitals/VitalSigns';

type SurgeryTab = 'board' | 'anesthesia' | 'pacu' | 'checklist';

// 서버 or-board 의 currentStatus 실값 = IN_USE | SCHEDULED | AVAILABLE (2026-08-04 계약 일치 — 종전 FE 가 없는 필드를 읽어 상시 '대기중'이었다)
const ROOM_STATUS_COLOR: Record<string, string> = {
  IN_USE: 'bg-red-500', IN_SURGERY: 'bg-red-500', SCHEDULED: 'bg-amber-500', PREPARING: 'bg-amber-500', PACU: 'bg-blue-500', AVAILABLE: 'bg-gray-300',
};
const ROOM_STATUS_LABEL: Record<string, string> = {
  IN_USE: '사용중', IN_SURGERY: '수술중', SCHEDULED: '예정', PREPARING: '준비중', PACU: '회복실', AVAILABLE: '대기',
};
const ROOM_CARD_BG: Record<string, string> = {
  IN_USE: 'border-red-300 bg-red-50', IN_SURGERY: 'border-red-300 bg-red-50', SCHEDULED: 'border-amber-300 bg-amber-50', PREPARING: 'border-amber-300 bg-amber-50', PACU: 'border-blue-300 bg-blue-50', AVAILABLE: 'border-gray-200 bg-gray-50',
};

const ASA_LABELS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/**
 * 🔴 (2026-09-12) 여기 있던 로컬 사본 `ANESTHESIA_TYPES` 가 shared 정본(`ANESTHESIA_LABEL`)과 **값이 갈라져** 있었다 —
 *    `SEDATION` 진정마취 ↔ 정본 수면마취 · `REGIONAL` 부위마취 ↔ 정본 부분마취 · `NONE`/`OTHER` 누락.
 *    같은 수술의 마취 종류가 이 화면과 수술 목록(`surgery/page.tsx` — 정본 경유)에서 **다른 이름**으로 읽혔다(P12).
 *    또 DB 에 영문 코드와 한글이 섞여 저장돼 있어(정본 머리 주석 실측) 로컬 맵은 한글 저장분을 못 받았다.
 *    → 정본 `anesthesiaText`(코드·한글 둘 다 받음)로 수렴. 정본이 아는 값은 카탈로그 키(`<T>`), 모르는 자유 기재는 원문(`<Data>`).
 */
function AnesthesiaName({ value }: { value: unknown }) {
  const raw = value == null ? '' : String(value);
  const text = anesthesiaText(raw);
  return KNOWN_ANESTHESIA.has(text) ? <T k={text} /> : <Data>{text}</Data>;
}
const KNOWN_ANESTHESIA = new Set(Object.values(ANESTHESIA_LABEL));

/* 🔴 체크리스트 항목 정의를 여기 두지 않는다 — 정본은 서버(`SurgeryAdvancedService.CHECKLIST_ITEMS`)이고
 *    화면은 `SurgicalChecklistPanel` 하나다. 종전 이 파일은 한글 라벨 20개를 따로 적어두고
 *    `signIn_0` 같은 인덱스 키로 `phase='sign-in'`(kebab)에 보냈다 —
 *    · phase 는 `ParseEnumPipe({signIn,timeOut,signOut})` 에 걸려 **전건 400**
 *    · 통과했더라도 본문 `{items:{...}}` 는 DTO 에 없는 키라 whitelist 가 통째로 지웠다
 *    · 게다가 저장/조회하던 `signInItems`·`signInAt`·`signInSigner` 는 스키마에 **없는 컬럼**이다.
 *    즉 이 탭은 개통 이래 한 건도 저장한 적이 없다. 정본 패널로 대체한다. */

export default function SurgeryAdvanced() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<SurgeryTab>('board');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [disposition, setDisposition] = useState('WARD');
  const [overrideReason, setOverrideReason] = useState('');

  // OR Board - rooms
  const { data: roomsData } = useQuery({
    queryKey: ['surgery-rooms'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/surgery/rooms'),
    enabled: tab === 'board',
    refetchInterval: pollMs('fast'),
  });

  // OR Board - board overview
  const { data: boardData } = useQuery({
    queryKey: ['surgery-board'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/surgery/or-board'),
    enabled: tab === 'board',
    refetchInterval: pollMs('fast'),
  });

  // Anesthesia detail
  const { data: anesthesiaData } = useQuery({
    queryKey: ['surgery-anesthesia', selectedId],
    queryFn: () => apiClient.get<{ data: unknown }>(`/api/v1/surgery/${selectedId}/anesthesia`),
    enabled: tab === 'anesthesia' && !!selectedId,
  });

  // PACU detail
  const { data: pacuData } = useQuery({
    queryKey: ['surgery-pacu', selectedId],
    queryFn: () => apiClient.get<{ data: unknown }>(`/api/v1/surgery/${selectedId}/pacu`),
    enabled: tab === 'pacu' && !!selectedId,
  });


  // Today's surgeries for anesthesia/pacu/checklist lists
  const { data: todaySurgeries } = useQuery({
    queryKey: ['surgery-today'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/surgery/schedule'),
    enabled: tab !== 'board',
    refetchInterval: pollMs('normal'),
  });

  // 퇴실은 PACU 게이트 API로만 — WARD/ICU: Aldrete≥9, HOME: PADSS≥9(미달 시 사유+의사 승인)
  const pacuDischargeMut = useMutation({
    mutationFn: ({ pacuRecordId, body }: { pacuRecordId: string; body: { disposition: string; overrideReason?: string } }) =>
      apiClient.post(`/api/v1/pacu/${pacuRecordId}/discharge`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['surgery-pacu'] });
      qc.invalidateQueries({ queryKey: ['surgery-today'] });
      toast.success('회복실 퇴실 처리 완료');
      setOverrideReason('');
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '퇴실 처리 실패'),
  });


  const extract = <T,>(raw: { data: unknown } | undefined): T => {
    const r = raw?.data;
    if (Array.isArray(r)) return r as T;
    const inner = (r as unknown as Record<string, unknown>)?.data;
    if (inner !== undefined) return inner as T;
    return r as T;
  };

  const rooms: Record<string, unknown>[] = extract<Record<string, unknown>[]>(roomsData) ?? [];
  const board: Record<string, unknown>[] = extract<Record<string, unknown>[]>(boardData) ?? [];
  const surgeries: Record<string, unknown>[] = extract<Record<string, unknown>[]>(todaySurgeries) ?? [];
  const anesthesia: Record<string, unknown> | null = extract<Record<string, unknown>>(anesthesiaData) ?? null;
  const pacu: Record<string, unknown> | null = extract<Record<string, unknown>>(pacuData) ?? null;
  /**
   * 🔴 미측정(`null`)과 **측정된 0** 을 구분한다 — `?? 0` 으로 접으면
   *    Aldrete 0(완전 무반응)·통증 0(통증 없음)을 재지도 않고 단정하게 된다.
   *    라벨은 정본 `lib/vital-flags` 의 `UNMEASURED_LABEL` 을 쓴다(화면마다 다른 표기를 만들지 않는다).
   */
  const measuredNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const aldrete = measuredNum(pacu?.aldretScore);
  const pain = measuredNum(pacu?.painScore);

  /* 체크리스트 진행도 — 목록 표에 찍는다.
   * 🔴 종전 표는 `surgery.checklist?.signIn` 을 읽었는데 `/api/v1/surgery/schedule` 은
   *    checklist 를 include 한 적이 없다 → 실제 상태와 무관하게 **전 행이 '미완료'** 였다(P11).
   *    실제로 서버가 아는 진행도를 일괄로 받아 찍는다. */
  const checklistIds = tab === 'checklist' ? surgeries.map(s => String(s.id)).filter(Boolean) : [];
  const { data: progressData } = useQuery({
    queryKey: ['surgery-checklist-progress', checklistIds.join(',')],
    queryFn: () => apiClient.get<{ data: unknown[] }>(`/api/v1/surgery/checklist-progress?surgeryIds=${encodeURIComponent(checklistIds.join(','))}`),
    enabled: tab === 'checklist' && checklistIds.length > 0,
  });
  type PhaseP = { requiredComplete: boolean; requiredDone: number; requiredTotal: number };
  const progressBySurgery = new Map<string, { signIn: PhaseP; timeOut: PhaseP; signOut: PhaseP }>(
    (extract<Array<{ surgeryId: string; progress: { signIn: PhaseP; timeOut: PhaseP; signOut: PhaseP } }>>(progressData) ?? [])
      .map(r => [r.surgeryId, r.progress]),
  );

  const displayRooms = board.length > 0 ? board : rooms;

  const getElapsed = (startedAt: unknown) => {
    if (!startedAt || typeof startedAt !== 'string') return 0;
    return Math.round((Date.now() - new Date(startedAt).getTime()) / 60000);
  };

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-900"><T k="수술 고급 관리" /></h3>
      </div>

      <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'board' as SurgeryTab, label: 'OR Board' },
          { key: 'anesthesia' as SurgeryTab, label: '마취기록' },
          { key: 'pacu' as SurgeryTab, label: '회복실(PACU)' },
          { key: 'checklist' as SurgeryTab, label: '안전체크리스트' },
        ]).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSelectedId(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
        ))}
      </div>

      {/* OR Board */}
      {tab === 'board' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {displayRooms.length === 0 ? (
            <EmptyState icon="🏥" title="수술방 정보가 없습니다" className="col-span-full" />
          ) : displayRooms.map((room) => {
            const status = String(room.currentStatus ?? room.status ?? room.roomStatus ?? 'AVAILABLE');
            // 오늘 일정 목록(서버가 수술 정보를 조인해 준다) — 현재 시간대 일정을 대표로
            const scheds = (room.schedules as { startTime: string; endTime: string; status: string; surgery?: { procedureName?: string; startedAt?: string; patient?: Record<string, string>; surgeon?: Record<string, string> } | null }[] | undefined) ?? [];
            const active = scheds.find((s) => s.status !== 'CANCELLED') ?? null;
            const surgery = (active?.surgery ?? room.currentSurgery ?? null) as Record<string, unknown> | null;
            const patient = (surgery?.patient ?? room.patient) as Record<string, string> | undefined;
            const surgeon = (surgery?.surgeon ?? room.surgeon) as Record<string, string> | undefined;
            const procedure = String(surgery?.procedureName ?? room.procedureName ?? '');
            const elapsed = getElapsed(surgery?.startedAt ?? room.startedAt);

            return (
              <div key={String(room.id ?? room.roomId)} className={`rounded-2xl border-2 p-4 ${ROOM_CARD_BG[status] ?? ROOM_CARD_BG.AVAILABLE}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-900">{String(room.name ?? room.roomName ?? `OR-${room.roomNumber ?? room.id}`)}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${ROOM_STATUS_COLOR[status] ?? ROOM_STATUS_COLOR.AVAILABLE} ${status === 'IN_SURGERY' ? 'animate-pulse' : ''}`} />
                    <span className={`text-[10px] font-bold whitespace-nowrap ${status === 'IN_SURGERY' ? 'text-red-700' : status === 'PREPARING' ? 'text-amber-700' : status === 'PACU' ? 'text-blue-700' : 'text-gray-500'}`}>
                      <T k={ROOM_STATUS_LABEL[status] ?? '대기'} />
                    </span>
                  </div>
                </div>

                {status !== 'AVAILABLE' && (patient || procedure) ? (
                  <div className="space-y-2 text-xs">
                    {patient && (
                      <div>
                        <span className="text-gray-400"><T k="환자" /></span>
                        <p className="font-medium text-gray-900">{patient.familyName}{patient.givenName}</p>
                      </div>
                    )}
                    {procedure && (
                      <div>
                        <span className="text-gray-400"><T k="수술" /></span>
                        <p className="text-gray-700 truncate">{procedure}</p>
                      </div>
                    )}
                    {surgeon && (
                      <div>
                        <span className="text-gray-400"><T k="집도의" /></span>
                        <p className="text-gray-700">{surgeon.familyName}{surgeon.givenName}</p>
                      </div>
                    )}
                    {active && (
                      <div>
                        <span className="text-gray-400"><T k="시간" /></span>
                        <p className="font-mono font-semibold text-gray-800">{active.startTime}~{active.endTime}</p>
                      </div>
                    )}
                    {(status === 'IN_SURGERY' || status === 'IN_USE') && (
                      <div className="flex items-center justify-between pt-1 border-t border-red-200">
                        <span className="text-gray-400"><T k="경과" /></span>
                        <span className="text-lg font-mono font-bold text-red-600"><Duration minutes={elapsed} /></span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 py-3 text-center"><T k="대기중" /></p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Anesthesia Tab */}
      {tab === 'anesthesia' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="수술명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="마취" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
              </tr></thead>
              <tbody>
                {surgeries.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="오늘 수술 기록이 없습니다" /></td></tr>
                ) : surgeries.map((s) => {
                  const patient = s.patient as Record<string, string> | undefined;
                  return (
                    <tr key={String(s.id)} onClick={() => setSelectedId(String(s.id))}
                      className={`border-b border-gray-50 cursor-pointer ${selectedId === String(s.id) ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {s.scheduledAt ? kdate(String(s.scheduledAt), 'time') : '-'}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{patient?.familyName}{patient?.givenName}</td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[200px]">{String(s.procedureName ?? '-')}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 whitespace-nowrap"><AnesthesiaName value={s.anesthesiaType} /></span></td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' : s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}><T k={s.status === 'IN_PROGRESS' ? '진행중' : s.status === 'COMPLETED' ? '완료' : '예정'} /></span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Anesthesia Detail */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-h-[700px] overflow-y-auto">
            {!selectedId ? (
              <p className="text-sm text-gray-400 text-center py-8"><T k="수술을 선택하세요" /></p>
            ) : !anesthesia ? (
              <EmptyState icon="📝" title="마취 기록이 없습니다" />
            ) : (
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-gray-900"><T k="마취 기록" /></h4>

                <div className="bg-indigo-50 rounded-xl p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-indigo-600"><T k="ASA 등급" /></span>
                    <span className="font-bold text-gray-900">ASA {ASA_LABELS[Number(anesthesia.asaClass ?? 1) - 1] ?? String(anesthesia.asaClass)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-indigo-600"><T k="마취 유형" /></span>
                    <span className="font-medium text-gray-900"><AnesthesiaName value={anesthesia.anesthesiaType} /></span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-indigo-600"><T k="기도 관리" /></span>
                    <span className="font-medium text-gray-900">{String(anesthesia.airway ?? '-')}</span>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-2"><T k="타임라인" /></p>
                  <div className="space-y-1.5">
                    {(['induction', 'intubation', 'incision', 'closure', 'extubation'] as const).map((phase) => {
                      const time = anesthesia[phase] ?? (anesthesia.timeline as unknown as Record<string, unknown>)?.[phase];
                      return (
                        <div key={phase} className="flex items-center gap-3 text-xs">
                          <span className="w-2 h-2 rounded-full bg-indigo-400" />
                          <span className="w-20 text-gray-500 capitalize"><T k={phase === 'induction' ? '유도' : phase === 'intubation' ? '삽관' : phase === 'incision' ? '절개' : phase === 'closure' ? '봉합' : '발관'} /></span>
                          <span className="font-mono text-gray-700">{time ? kdate(String(time), 'time') : '-'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Drugs */}
                {Array.isArray(anesthesia.drugs) && (anesthesia.drugs as unknown[]).length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 mb-1.5"><T k="투여 약물" /></p>
                    <div className="space-y-1">
                      {(anesthesia.drugs as Record<string, unknown>[]).map((d, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] p-1.5 rounded bg-gray-50">
                          <span className="text-gray-700 font-medium">{String(d.name ?? d.drugName)}</span>
                          <span className="text-gray-500">{String(d.dose ?? '')} {String(d.unit ?? '')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* I/O Summary */}
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-500 mb-1.5"><T k="I/O 요약" /></p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-gray-400"><T k="수액" /></span><p className="font-medium text-gray-900">{String(anesthesia.fluidInput ?? anesthesia.totalInput ?? '-')} mL</p></div>
                    <div><span className="text-gray-400"><T k="출혈량" /></span><p className="font-medium text-red-600">{String(anesthesia.bloodLoss ?? anesthesia.estimatedBloodLoss ?? '-')} mL</p></div>
                    <div><span className="text-gray-400"><T k="소변량" /></span><p className="font-medium text-gray-900">{String(anesthesia.urineOutput ?? '-')} mL</p></div>
                    <div><span className="text-gray-400"><T k="총 출력" /></span><p className="font-medium text-gray-900">{String(anesthesia.totalOutput ?? '-')} mL</p></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PACU Tab */}
      {tab === 'pacu' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="수술명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]">Aldrete</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
              </tr></thead>
              <tbody>
                {surgeries.filter(s => s.status === 'COMPLETED' || s.status === 'IN_PACU').length === 0 ? (
                  <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="회복실 환자가 없습니다" /></td></tr>
                ) : surgeries.filter(s => s.status === 'COMPLETED' || s.status === 'IN_PACU').map((s) => {
                  const patient = s.patient as Record<string, string> | undefined;
                  return (
                    <tr key={String(s.id)} onClick={() => setSelectedId(String(s.id))}
                      className={`border-b border-gray-50 cursor-pointer ${selectedId === String(s.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{patient?.familyName}{patient?.givenName}</td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[200px]">{String(s.procedureName ?? '-')}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">{String(s.aldreteScore ?? '-')}/10</span></td>
                      <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 whitespace-nowrap"><T k="회복중" /></span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* PACU Detail */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-h-[700px] overflow-y-auto">
            {!selectedId ? (
              <p className="text-sm text-gray-400 text-center py-8"><T k="환자를 선택하세요" /></p>
            ) : !pacu ? (
              <EmptyState icon="📝" title="PACU 기록이 없습니다" />
            ) : (
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-gray-900"><T k="회복실 기록" /></h4>

                {/*
                  🔴 (2026-09-16 I4) 서버는 **미측정을 `null` 로** 준다(`pacu.service` "미측정은 null 이다 · 0(측정된 0)과 구분한다").
                     그런데 화면이 `?? 0` 으로 그 사실을 버리고 있었다:
                     · Aldrete 0/10 = **완전 무반응·무호흡** 상태를 단정(퇴실 기준은 ≥9 다)
                     · 통증 0/10 을 **초록**으로 = 재지도 않은 환자를 "통증 없음"으로 단정
                     미측정은 판정하지 않는다 — 정본 `lib/vital-flags`(warnIf·UNMEASURED_LABEL) 규약과 같게 맞춘다.
                */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold text-gray-500">Aldrete Score</p>
                    <span className={`text-sm font-bold ${aldrete === null ? 'text-gray-400' : 'text-blue-700'}`}>
                      {aldrete === null ? UNMEASURED_LABEL : `${aldrete}/10`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    {aldrete !== null && (
                      <div className={`h-3 rounded-full transition-all ${aldrete >= 9 ? 'bg-emerald-500' : aldrete >= 7 ? 'bg-blue-500' : 'bg-amber-500'}`}
                        style={{ width: `${(aldrete / 10) * 100}%` }} />
                    )}
                  </div>
                </div>

                {/* Pain Score */}
                <div className="bg-blue-50 rounded-xl p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-600"><T k="통증 점수 (NRS)" /></span>
                    <span className={`text-lg font-bold ${pain === null ? 'text-gray-400' : pain >= 7 ? 'text-red-600' : pain >= 4 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {pain === null ? UNMEASURED_LABEL : `${pain}/10`}
                    </span>
                  </div>
                </div>

                {/* Vital Signs */}
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-1.5"><T k="활력징후" /></p>
                  {/* 🔴 (2026-10-07) 표시 부품 정본 — 종전엔 값 없는 항목이 사라졌고 `°C`·원문 문자열·이상 색 없음.
                       별칭(spO2·"120/80" 혈압)은 부품이 읽고 미측정은 '—' */}
                  <VitalSignsGrid vitals={(pacu.vitals ?? pacu.vitalSigns ?? pacu) as Record<string, unknown>} columns={3}
                    keys={['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature']} />
                </div>

                {/* Oxygen Therapy */}
                {Boolean(pacu.oxygenTherapy) && (
                  <div className="bg-gray-50 rounded-xl p-3 text-xs">
                    <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="산소 치료" /></p>
                    <p className="text-gray-700">{String(pacu.oxygenTherapy)}</p>
                  </div>
                )}

                {/* Interventions */}
                {Array.isArray(pacu.interventions) && (pacu.interventions as unknown[]).length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="중재" /></p>
                    <div className="space-y-1">
                      {(pacu.interventions as Record<string, unknown>[]).map((intervention, i) => (
                        <div key={i} className="text-[10px] p-1.5 rounded bg-gray-50 text-gray-700">
                          {String(intervention.description ?? intervention.name ?? intervention)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Discharge — 이원화 게이트(HOME: PADSS≥9 / WARD·ICU: Aldrete≥9) */}
                <div className="pt-2 border-t border-gray-100 space-y-2">
                  {pacu.dischargeTime ? (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-700">
                      퇴실 완료 · {String(pacu.disposition ?? '-')} · {kdate(String(pacu.dischargeTime), 'datetimeSec')}
                    </div>
                  ) : (() => {
                    const isHome = disposition === 'HOME';
                    const savedScore = Number((isHome ? pacu.padssScore : pacu.aldretScore) ?? 0);
                    const belowThreshold = savedScore < 9;
                    const scaleName = isHome ? 'PADSS' : 'Aldrete';
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <select value={disposition} onChange={e => setDisposition(e.target.value)}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white">
                            <option value="WARD"><T k="병동 (WARD)" /></option>
                            <option value="ICU"><T k="중환자실 (ICU)" /></option>
                            <option value="HOME"><T k="귀가 (HOME)" /></option>
                          </select>
                          <span className="text-[11px] text-gray-500"><T k="기준:" /> <b>{scaleName} ≥ 9</b> · <Tf k="현재 {점수}점" params={{ 점수: savedScore }} /></span>
                        </div>
                        {belowThreshold && (
                          <>
                            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-[11px] text-red-700">
                              ⚠️ {scaleName} <b>{savedScore}<Unit><T k="점" /></Unit></b> <T k="— 퇴실 기준(9점) 미달. 강제 퇴실 시" /> <b><T k="사유(마취과 판단)" /></b> <T k="필수이며 감사 기록됩니다." />
                            </div>
                            <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                              placeholder={tAttr('강제 퇴실 사유 (예: 마취과 OO 판단 하 병동 이송)')}
                              className="w-full px-3 py-2 border border-red-200 rounded-lg text-xs" />
                          </>
                        )}
                        <button
                          onClick={() => pacuDischargeMut.mutate({
                            pacuRecordId: String(pacu.id),
                            body: { disposition, overrideReason: belowThreshold ? overrideReason.trim() : undefined },
                          })}
                          disabled={pacuDischargeMut.isPending || (belowThreshold && !overrideReason.trim())}
                          className="w-full py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                          <T k={pacuDischargeMut.isPending ? '처리중...' : belowThreshold ? '강제 퇴실' : '회복실 퇴실'} />
                        </button>
                        <a href="/pacu" className="block text-center text-[11px] text-blue-600 hover:underline">
                          <T k="회복실 워크스테이션에서 상세 관리 (SBAR 인수인계·평가) →" />
                        </a>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checklist Tab — 정본(SurgicalChecklistPanel) 하나로 수렴 */}
      {tab === 'checklist' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_520px] gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="수술명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]">Sign In</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]">Time Out</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]">Sign Out</th>
              </tr></thead>
              <tbody>
                {surgeries.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="오늘 수술 기록이 없습니다" /></td></tr>
                ) : surgeries.map((s) => {
                  const patient = s.patient as Record<string, string> | undefined;
                  const prog = progressBySurgery.get(String(s.id));
                  /* 🔴 체크리스트가 아직 없는 수술은 '미완료'가 아니라 **미작성**이다 —
                   *    아는 것과 모르는 것을 뒤바꿔 말하지 않는다(P1). */
                  const cell = (ph: 'signIn' | 'timeOut' | 'signOut') => {
                    if (!prog) return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-50 text-gray-400"><T k="미작성" /></span>;
                    const p = prog[ph];
                    return (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${p.requiredComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                        {p.requiredComplete ? '완료' : `${p.requiredDone}/${p.requiredTotal}`}
                      </span>
                    );
                  };
                  return (
                    <tr key={String(s.id)} onClick={() => setSelectedId(String(s.id))}
                      className={`border-b border-gray-50 cursor-pointer ${selectedId === String(s.id) ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{patient?.familyName}{patient?.givenName}</td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[200px]">{String(s.procedureName ?? '-')}</td>
                      <td className="px-4 py-3">{cell('signIn')}</td>
                      <td className="px-4 py-3">{cell('timeOut')}</td>
                      <td className="px-4 py-3">{cell('signOut')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Checklist Detail — 정본 패널 그대로 */}
          <div className="max-h-[760px] overflow-y-auto">
            {!selectedId ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-sm text-gray-400 text-center py-8"><T k="수술을 선택하세요" /></p>
              </div>
            ) : (
              <SurgicalChecklistPanel
                surgeryId={selectedId}
                status={String(surgeries.find(s => String(s.id) === selectedId)?.status ?? '')}
              />
            )}
          </div>
        </div>
      )}

    </div>
  );
}
