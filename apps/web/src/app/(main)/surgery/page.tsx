'use client';

import { useState } from 'react';
import { anesthesiaText } from '@hospital-run/shared';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { extractErrorMessage } from '@/lib/error-utils';
import { safeFormat as format } from '@/lib/safe-date';
import SurgeryAdvanced from './components/SurgeryAdvanced';
import SurgeryLiveBoard from './components/SurgeryLiveBoard';
import SurgeryQualityPanel from './components/SurgeryQualityPanel';
import { AiSuggestionPanel } from '@/components/ai/AiSuggestionPanel';
import { pollMs } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

import { EmptyState, Unit, Duration } from '@/components/ui/display';

interface SurgeryEntry {
  id: string;
  status: string;
  procedureName: string;
  scheduledAt: string;
  startedAt?: string;
  endedAt?: string;
  anesthesiaType?: string;
  patient?: { familyName: string; givenName: string };
  surgeon?: { familyName: string; givenName: string };
  opNote?: string;
  /** 수술방 배정(OrSchedule 조인) — 미배정이면 null. 예상 소요시간의 정본도 여기 있다. */
  orRoom?: { name: string; startTime?: string; endTime?: string; estimatedDuration?: number } | null;
}

interface OperatingRoomItem { id: string; name: string; roomType?: string; isActive?: boolean; }

/** 수술방 배지 — 미배정은 회색으로 사실대로 */
function RoomBadge({ room }: { room?: SurgeryEntry['orRoom'] }) {
  if (!room) return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 whitespace-nowrap"><T k="미배정" /></span>;
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 whitespace-nowrap"
      title={room.startTime ? `${room.startTime}~${room.endTime ?? ''}${room.estimatedDuration ? ` · 예상 ${room.estimatedDuration}분` : ''}` : undefined}>
      🚪 {room.name}
    </span>
  );
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  SCHEDULED: { label: '예정', bg: 'bg-blue-50', text: 'text-blue-700' },
  IN_PROGRESS: { label: '진행중', bg: 'bg-amber-50', text: 'text-amber-700' },
  COMPLETED: { label: '완료', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  CANCELLED: { label: '취소', bg: 'bg-gray-100', text: 'text-gray-500' },
};

export default function SurgeryPage() {
  const qc = useQueryClient();
  const tA = useTAttr();
  // 2026-10-05 실시간 모니터(기본)·질 지표 탭 추가 — 종전 '수술방 현황'은 목록 보기로 남긴다
  const [tab, setTab] = useState<'live' | 'quality' | 'dashboard' | 'schedule' | 'completed'>('live');
  const [assignTarget, setAssignTarget] = useState<SurgeryEntry | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['surgery-all'],
    queryFn: () => apiClient.get<{ data: SurgeryEntry[] }>('/api/v1/surgery/schedule'),
    refetchInterval: pollMs('fast'),
  });

  const startMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/surgery/${id}/start`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surgery-all'] }),
  });

  const _surgeriesRaw = data?.data;
  const surgeries: SurgeryEntry[] = Array.isArray(_surgeriesRaw) ? _surgeriesRaw : (_surgeriesRaw as unknown as { data?: SurgeryEntry[] })?.data ?? [];
  const scheduled = surgeries.filter((s) => s.status === 'SCHEDULED');
  const inProgress = surgeries.filter((s) => s.status === 'IN_PROGRESS');
  const completed = surgeries.filter((s) => s.status === 'COMPLETED');

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900"><T k="수술방 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="수술방 실시간 모니터 · 질 지표 · 스케줄 · Op Note" /></p>
      </div>

      {/* 대시보드 카드 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-xl p-4"><p className="text-xs text-blue-500 font-medium"><T k="예정" /></p><p className="text-3xl font-bold text-blue-700 mt-1">{scheduled.length}</p></div>
        <div className="bg-amber-50 rounded-xl p-4"><p className="text-xs text-amber-500 font-medium"><T k="진행중" /></p><p className="text-3xl font-bold text-amber-700 mt-1">{inProgress.length}</p></div>
        <div className="bg-emerald-50 rounded-xl p-4"><p className="text-xs text-emerald-500 font-medium"><T k="완료" /></p><p className="text-3xl font-bold text-emerald-700 mt-1">{completed.length}</p></div>
        <div className="bg-indigo-50 rounded-xl p-4"><p className="text-xs text-indigo-500 font-medium"><T k="총 스케줄" /></p><p className="text-3xl font-bold text-indigo-700 mt-1">{surgeries.length}</p></div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['live', 'quality', 'dashboard', 'schedule', 'completed'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium rounded-lg ${tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            <T k={t === 'live' ? '실시간 모니터' : t === 'quality' ? '질 지표' : t === 'dashboard' ? '수술방 현황' : t === 'schedule' ? '스케줄' : '완료 (Op Note)'} />
          </button>
        ))}
      </div>

      {tab === 'live' && <SurgeryLiveBoard />}
      {tab === 'quality' && <SurgeryQualityPanel />}

      {/* 수술방 현황 */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {inProgress.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-amber-700 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> <T k="현재 진행중" />
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {inProgress.map((s) => {
                  const elapsed = s.startedAt ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000) : 0;
                  return (
                    <div key={s.id} className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-3 gap-2">
                        <span className="text-lg font-bold text-amber-800 min-w-0 truncate">{s.procedureName}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <RoomBadge room={s.orRoom} />
                          <span className="text-2xl font-mono font-bold text-amber-600"><Duration minutes={elapsed} /></span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-amber-500 text-xs"><T k="환자" /></span><p className="font-medium">{s.patient?.familyName}{s.patient?.givenName}</p></div>
                        <div><span className="text-amber-500 text-xs"><T k="집도의" /></span><p className="font-medium">{s.surgeon?.familyName}{s.surgeon?.givenName}</p></div>
                        <div><span className="text-amber-500 text-xs"><T k="마취" /></span><p>{anesthesiaText(s.anesthesiaType)}</p></div>
                        <div><span className="text-amber-500 text-xs"><T k="시작" /></span><p>{s.startedAt ? format(new Date(s.startedAt), 'HH:mm') : '-'}</p></div>
                      </div>
                      <Link href={`/surgery/${s.id}`} className="mt-3 block text-center py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700"><T k="Op Note 작성" /></Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <h3 className="text-sm font-bold text-blue-700 mb-3"><T k="예정" /> ({scheduled.length})</h3>
            {scheduled.length === 0 ? (
              <EmptyState icon="🏥" title="예정된 수술이 없습니다" className="bg-white rounded-xl border" />
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="시간" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="수술방" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="수술명" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="집도의" /></th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="마취" /></th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500"><T k="액션" /></th>
                  </tr></thead>
                  <tbody>
                    {scheduled.map((s) => (
                      <tr key={s.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                        <td className="px-4 py-3 font-mono font-bold text-blue-700">{format(new Date(s.scheduledAt), 'HH:mm')}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <RoomBadge room={s.orRoom} />
                            {!s.orRoom && (
                              <button onClick={() => setAssignTarget(s)} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 whitespace-nowrap"><T k="배정" /></button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium">{s.patient?.familyName}{s.patient?.givenName}</td>
                        <td className="px-4 py-3 text-gray-700">{s.procedureName}</td>
                        <td className="px-4 py-3 text-gray-600">{s.surgeon?.familyName}{s.surgeon?.givenName}</td>
                        {/* 🔴 종전 영문 코드(GENERAL·LOCAL)가 그대로 노출됐다 */}
                        <td className="px-4 py-3 text-gray-500">{anesthesiaText(s.anesthesiaType)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center gap-2 justify-center">
                            <button onClick={() => startMut.mutate(s.id)} disabled={startMut.isPending} className="min-h-[44px] px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k="수술 시작" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 전체 스케줄 */}
      {tab === 'schedule' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="예정일시" /></th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="수술방" /></th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="수술명" /></th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="집도의" /></th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500"><T k="상세" /></th>
            </tr></thead>
            <tbody>
              {surgeries.map((s) => {
                const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.SCHEDULED;
                return (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-600">{format(new Date(s.scheduledAt), 'MM/dd HH:mm')}</td>
                    <td className="px-4 py-3"><RoomBadge room={s.orRoom} /></td>
                    <td className="px-4 py-3 font-medium">{s.patient?.familyName}{s.patient?.givenName}</td>
                    <td className="px-4 py-3 text-gray-700">{s.procedureName}</td>
                    <td className="px-4 py-3 text-gray-600">{s.surgeon?.familyName}{s.surgeon?.givenName}</td>
                    <td className="px-4 py-3"><span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}><T k={cfg.label} /></span></td>
                    <td className="px-4 py-3 text-center"><Link href={`/surgery/${s.id}`} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"><T k="상세" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 완료 Op Note */}
      {tab === 'completed' && (
        <div className="space-y-3">
          {completed.length === 0 ? (
            <EmptyState icon="🏥" title="완료된 수술이 없습니다" className="bg-white rounded-xl border" />
          ) : completed.map((s) => (
            <Link key={s.id} href={`/surgery/${s.id}`} className="block bg-white rounded-xl border border-gray-100 p-4 hover:bg-emerald-50/30 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-gray-900">{s.procedureName}</span>
                <span className="text-xs text-gray-400">{s.startedAt && s.endedAt ? `${Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)}분` : '-'}</span>
              </div>
              <div className="flex gap-4 text-xs text-gray-500 items-center flex-wrap">
                <RoomBadge room={s.orRoom} />
                <span><T k="환자" />: {s.patient?.familyName}{s.patient?.givenName}</span>
                <span><T k="집도의" />: {s.surgeon?.familyName}{s.surgeon?.givenName}</span>
                <span>{s.endedAt ? format(new Date(s.endedAt), 'MM/dd HH:mm') : '-'}</span>
              </div>
              {s.opNote && <p className="text-xs text-gray-600 mt-2 line-clamp-2">{s.opNote}</p>}
            </Link>
          ))}
        </div>
      )}

      <SurgeryAdvanced />

      {assignTarget && (
        <AssignRoomModal surgery={assignTarget} onClose={() => setAssignTarget(null)}
          onDone={() => { setAssignTarget(null); qc.invalidateQueries({ queryKey: ['surgery-all'] }); }} />
      )}
    </div>
  );
}

/**
 * 수술방 배정 모달 — 서버의 룸 락 원자화(rooms/assign·이중예약 방지)를 그대로 사용.
 * 시간은 예약시각으로 프리필(기본 2시간) — 충돌이면 서버가 409 로 거절한다.
 *
 * 🔴 **예상 소요시간(OrSchedule.estimatedDuration)의 정본은 이 화면이다.** 예약 화면(진료 레이아웃)에는
 *    그 값을 담을 컬럼이 없다(방을 정하기 전에는 OrSchedule 행 자체가 없다). 종전엔 이 화면이
 *    소요시간을 **묻지도 보여주지도 않고** 종료-시작으로 계산해 보냈고, 종료가 시작보다 앞서면
 *    `Math.max(30, …)` 이 조용히 30분으로 바꿔 **입력한 적 없는 값을 저장**했다.
 *    이제는 소요시간을 드러내 입력받고(종료 시각과 양방향), 뒤집힌 시간은 저장하지 않고 말한다.
 *
 *    한계(고치지 않고 남긴 것): OrSchedule 은 날짜 1개 + 'HH:MM' 문자열이라 **자정을 넘는 수술을
 *    표현하지 못한다**(충돌검사도 문자열 비교다). 그래서 23:00 시작·120분 같은 입력은 저장되지 않고
 *    거절된다 — 잘못된 값을 저장하는 것보다 낫지만, 진짜 해결은 스키마(시작·종료 timestamptz)다.
 */
function AssignRoomModal({ surgery, onClose, onDone }: {
  surgery: SurgeryEntry; onClose: () => void; onDone: () => void;
}) {
  const tA = useTAttr();
  const sched = new Date(surgery.scheduledAt);
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const [roomId, setRoomId] = useState('');
  const [startTime, setStartTime] = useState(hhmm(sched));
  const [endTime, setEndTime] = useState(hhmm(new Date(sched.getTime() + 2 * 3600_000)));
  const [err, setErr] = useState<string | null>(null);

  const toMin = (t: string) => {
    const m = /^(\d{2}):(\d{2})$/.exec(t);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  const durMin = startMin !== null && endMin !== null ? endMin - startMin : null;
  const durValid = durMin !== null && durMin > 0;
  /** 소요시간(분)을 직접 입력하면 종료 시각을 따라 옮긴다 — 두 값이 어긋난 채 저장되지 않게. */
  const setDuration = (mins: number) => {
    if (startMin === null || !Number.isFinite(mins) || mins <= 0) return;
    const end = (startMin + mins) % (24 * 60);
    setEndTime(`${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`);
  };

  const { data } = useQuery({
    queryKey: ['operating-rooms'],
    queryFn: () => apiClient.get<{ data: OperatingRoomItem[] }>('/api/v1/surgery/rooms'),
    staleTime: 300_000,
  });
  const raw = data?.data;
  const rooms: OperatingRoomItem[] = (Array.isArray(raw) ? raw : (raw as unknown as { data?: OperatingRoomItem[] })?.data ?? []).filter(r => r.isActive !== false);

  const assign = useMutation({
    mutationFn: () => {
      if (!durValid) throw new Error('종료 시각이 시작 시각보다 뒤여야 합니다 — 소요시간을 확인하세요.');
      return apiClient.post('/api/v1/surgery/rooms/assign', {
        roomId, surgeryId: surgery.id,
        date: format(sched, 'yyyy-MM-dd'), startTime, endTime,
        estimatedDuration: durMin,
      });
    },
    onSuccess: onDone,
    onError: (e) => setErr((e as { message?: string })?.message || '배정에 실패했습니다 (시간 충돌 여부를 확인하세요)'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900"><T k="수술방 배정" /></h3>
        <p className="text-xs text-gray-500">{surgery.procedureName} · {format(sched, 'MM/dd HH:mm')} · {surgery.patient?.familyName}{surgery.patient?.givenName}</p>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술방" /></label>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="">{tA('선택하세요')}</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.roomType ? ` (${r.roomType})` : ''}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="시작" /></label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="종료@시각" /></label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="예상 소요(분)" /></label>
            <input type="number" min={1} step={5} value={durValid ? durMin : ''} placeholder="—"
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        {!durValid && <p className="text-xs text-amber-600"><T k="종료 시각이 시작 시각보다 뒤여야 합니다 — 소요시간을 산출할 수 없습니다." /></p>}
        {err && <p className="text-xs text-rose-600">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => assign.mutate()} disabled={!roomId || !durValid || assign.isPending}
            className="flex-1 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">
            <T k={assign.isPending ? '배정 중…' : '배정'} />
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-200"><T k="취소" /></button>
        </div>
      </div>
    </div>
  );
}

// 2026-10-05 제거: 수술 위험도 인라인 배지 — 목록이 열릴 때 행마다 AI(ai-risk)를 자동으로 불러 "평가됨"만 보였다(결과 없음).
//   AI 는 누를 때만 — 위험도 예측은 수술 준비 워크스테이션의 요청 버튼(결과·근거 표시)에서.
