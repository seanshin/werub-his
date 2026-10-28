'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useDurationText } from '@/components/ui/display';
import { FreshnessBadge } from './FreshnessBadge';
import { localeTimeText } from '@hospital-run/shared';

/**
 * 외래 호출 전광판(구형) — 기설치 단말 호환용 보드 본체.
 *
 * 🔴 2026-08-14 W9 — **이 보드는 서버가 보내지 않는 필드 이름을 읽고 있었다**(P11).
 *    운영 SSE(`/api/v1/queue/public/stream`) 실측 페이로드는
 *    `{ patientName, status:'IN_CONSULTATION', waiting, called, inConsultation, completedToday }` 인데
 *    화면은 `patientInitial` · `inProgress` · `completed` · `status==='IN_PROGRESS'` 를 읽었다. 결과:
 *      ① 대기 목록의 **환자 이름 칸이 통째로 빈칸**(undefined) — 번호만 뜬다
 *      ② 호출 오버레이가 "  님" 으로 떠 **누구를 부르는지 화면이 말하지 못했다**
 *      ③ 요약 타일 '진료 중'·'완료'가 **영구 0** (진료 24건을 마친 과도 0으로 보였다)
 *      ④ 진료중 행이 상태 배지에 **`IN_CONSULTATION` 원문**을 노출하고 색도 안 붙었다
 *    `patientInitial` 은 리포 전체에서 이 파일에만 있었다 — 서버에 없는 이름이었다.
 *
 * 🔴 2026-08-14 W8 — 종전엔 `/display/waiting/page.tsx` 안에만 있어서 **박스 지정 경로에서 쓸 수 없었다.**
 *    `/admin/displays/<id>` 세팅에서 보드로 `waiting` 을 고르면 서버는 저장하고 화면은
 *    "저장했습니다 — 1분 안에 반영합니다"라고 말했지만, `/display/box/<key>` 는 `clinic-queue`·`er-flow`
 *    두 가지만 분기해서 TV 는 계속 **"표시할 보드가 아직 지정되지 않았습니다"** 를 띄웠다(P16).
 *    → 보드를 컴포넌트로 분리해 직접 URL 경로와 박스 경로가 **같은 것**을 쓰게 한다.
 *
 * 🔴 동반 — 세팅 화면은 이 보드에도 '표시할 진료과'를 고르게 해놓고 구형 페이지는 그 값을 무시했다.
 *    여기서 실제로 걸러낸다(요약 수치도 걸러낸 것만으로 다시 센다 — 필터와 총계가 어긋나면 안 된다).
 */

/** 서버 SSE `queue-update` 가 실제로 보내는 이름 그대로 — 추측한 이름을 쓰면 화면이 조용히 빈칸이 된다 */
interface QueueItem {
  queueNumber: number;
  patientName: string; // 서버 마스킹(홍○동)
  status: string;
  departmentName?: string;
  roomName?: string | null;
  waitMinutes?: number | null; // 아직 오지 않은 접수 시각은 null(서버 계약)
  calledAt?: string | null;
}

interface DepartmentQueue {
  name: string;
  queues: QueueItem[];
  waiting: number;
  called: number;
  inConsultation: number;
  completedToday: number;
}

interface CallEvent {
  queueNumber: number;
  patientName: string; // 서버 마스킹
  departmentName: string;
  roomName: string | null;
}

/** 상태 한글 라벨 — 원문 enum(`IN_CONSULTATION`)이 전광판에 그대로 뜨던 것 봉합 */
const STATUS_LABEL: Record<string, string> = {
  WAITING: '대기',
  CALLED: '호출',
  IN_CONSULTATION: '진료중',
  CASHIER_WAITING: '수납 대기',
  PHARMACY_WAITING: '약국 대기',
};

export function LegacyWaitingBoard({ departments = '' }: { departments?: string }) {
  const fmtDur = useDurationText();
  const filter = departments.split(',').map((d) => d.trim()).filter(Boolean);
  const [allDepartments, setAllDepartments] = useState<DepartmentQueue[]>([]);
  const [callEvent, setCallEvent] = useState<CallEvent | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [connected, setConnected] = useState(false);
  /** 자료를 **받은** 시각 — 시계(currentTime)와 분리한다. 섞으면 화면이 늘 최신인 척한다 */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const callTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const filterRef = useRef<string[]>(filter);
  filterRef.current = filter;

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // SSE Connection
  const connectStream = useCallback(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${apiUrl}/api/v1/queue/public/stream`;

    const evtSource = new EventSource(url);
    // 🔴 종전엔 EventSource 를 만들자마자 '실시간 연결'로 칠했다 — 서버가 응답하지 않아도 초록불이었다.
    //    연결은 onopen 이 알려준다(P17: 근거 없이 안심시킴).
    evtSource.onopen = () => setConnected(true);

    evtSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.event === 'call' && parsed.data) {
          // 이 TV 가 담당하지 않는 과의 호출은 띄우지 않는다
          const f = filterRef.current;
          if (f.length > 0 && !f.includes(parsed.data.departmentName)) return;
          setCallEvent(parsed.data);
          if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
          callTimeoutRef.current = setTimeout(() => setCallEvent(null), 8000);
        } else if (parsed.event === 'queue-update' && parsed.data) {
          setAllDepartments(parsed.data.departments || []);
          setUpdatedAt(Date.now()); // 목록을 실제로 받은 순간만 갱신 시각으로 친다
        }
      } catch { /* ignore parse errors */ }
    };

    evtSource.onerror = () => {
      setConnected(false);
      evtSource.close();
      setTimeout(connectStream, 5000);
    };

    return () => { evtSource.close(); setConnected(false); };
  }, []);

  useEffect(() => {
    const cleanup = connectStream();
    return cleanup;
  }, [connectStream]);

  // 🔴 요약 수치는 서버 totalStats(전체 과)가 아니라 **화면에 실제로 보이는 과**에서 다시 센다.
  //    "이 TV 는 내과만 보여주는데 대기 96명"처럼 필터와 총계가 어긋나면 안 된다.
  const depts = filter.length > 0 ? allDepartments.filter((d) => filter.includes(d.name)) : allDepartments;
  const totalWaiting = depts.reduce((s, d) => s + (d.waiting || 0), 0);
  // 🔴 `d.inProgress`·`d.completed` 는 서버에 없는 이름이라 두 타일이 **영구 0** 이었다(W9·P11)
  const totalInProgress = depts.reduce((s, d) => s + (d.inConsultation || 0), 0);
  const totalCompleted = depts.reduce((s, d) => s + (d.completedToday || 0), 0);

  const timeStr = localeTimeText(currentTime, 'ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = currentTime.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 text-white p-6 overflow-hidden relative">
      {/* Call Overlay */}
      {callEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-pulse">
          <div className="bg-white text-gray-900 rounded-3xl p-12 text-center shadow-2xl max-w-lg w-full mx-4">
            <p className="text-2xl text-blue-600 font-semibold mb-2">{callEvent.departmentName}</p>
            <p className="text-8xl font-black text-blue-800 mb-4">{callEvent.queueNumber}번</p>
            <p className="text-xl text-gray-600">{callEvent.patientName} 님</p>
            <div className="mt-6 bg-blue-100 rounded-xl p-4">
              {/* 🔴 진료실 미배정(roomName=null)이면 종전엔 "으로 오세요"만 떴다 — 서버 TTS 규약과 같이 '접수 창구'로 말한다 */}
              <p className="text-lg font-semibold text-blue-800">
                {callEvent.roomName ? `${callEvent.roomName}으로 오세요` : `${callEvent.departmentName} 접수 창구로 오세요`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">진료 대기 현황</h1>
          <p className="text-blue-200 text-sm mt-1">
            {dateStr}
            {filter.length > 0 && <span className="ml-2 text-blue-300">· {filter.join(' · ')}</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-mono font-bold">{timeStr}</p>
          <div className="flex items-center gap-2 mt-1 justify-end">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs text-blue-200">{connected ? '실시간 연결' : '재연결 중...'}</span>
            {/* 🔴 연결 표시만으로는 부족하다 — 연결이 살아 있어도 목록이 멈출 수 있다. 받은 시각을 말한다 */}
            <FreshnessBadge updatedAt={updatedAt} staleAfterSec={20} className="text-xs" />
          </div>
        </div>
      </header>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center">
          <p className="text-3xl font-bold">{totalWaiting}</p>
          <p className="text-sm text-blue-200">대기 중{filter.length > 0 && ' (표시 과 기준)'}</p>
        </div>
        <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center">
          <p className="text-3xl font-bold">{totalInProgress}</p>
          <p className="text-sm text-blue-200">진료 중{filter.length > 0 && ' (표시 과 기준)'}</p>
        </div>
        <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center">
          <p className="text-3xl font-bold">{totalCompleted}</p>
          <p className="text-sm text-blue-200">완료{filter.length > 0 && ' (표시 과 기준)'}</p>
        </div>
      </div>

      {/* Department Queues */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {depts.length === 0 ? (
          <div className="col-span-full text-center py-20 text-blue-200">
            <p className="text-5xl mb-4">🏥</p>
            <p className="text-xl">
              {!connected ? '대기 정보를 불러오는 중입니다' : filter.length > 0 && allDepartments.length > 0
                ? '지정한 진료과에 대기 환자가 없습니다'
                : '현재 대기 환자가 없습니다'}
            </p>
            <p className="text-sm mt-2">진료 시작 시 자동으로 표시됩니다</p>
          </div>
        ) : (
          depts.map((dept) => (
            <div key={dept.name} className="bg-white/10 backdrop-blur rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-lg">{dept.name}</h3>
                <span className="bg-blue-500/50 px-2 py-0.5 rounded text-xs">
                  대기 {dept.waiting}
                </span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {(dept.queues || []).slice(0, 8).map((q) => (
                  <div
                    key={q.queueNumber}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                      q.status === 'CALLED' ? 'bg-yellow-500/30 animate-pulse' :
                      q.status === 'IN_CONSULTATION' ? 'bg-green-500/20' :
                      'bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{q.queueNumber}</span>
                      <span className="text-sm text-blue-200">{q.patientName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* 대기 시간은 정본 포맷 경유 — 서버가 null(아직 오지 않은 접수 시각)을 보내면 '-' */}
                      {q.status === 'WAITING' && (
                        <span className="text-xs text-blue-200/80 tabular-nums">{fmtDur(q.waitMinutes)}</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                        q.status === 'CALLED' ? 'bg-yellow-500 text-black font-bold' :
                        q.status === 'IN_CONSULTATION' ? 'bg-green-500 text-white' :
                        'bg-white/20'
                      }`}>
                        {STATUS_LABEL[q.status] ?? q.status}
                      </span>
                    </div>
                  </div>
                ))}
                {/* 🔴 8건 넘게 대기 중이면 '잘렸다'는 사실을 말한다 — 조용히 사라지면 대기 수와 목록이 어긋난다 */}
                {(dept.queues?.length ?? 0) > 8 && (
                  <p className="text-center text-[11px] text-blue-200 pt-1">외 {(dept.queues?.length ?? 0) - 8}명 더 대기</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <footer className="absolute bottom-4 left-0 right-0 text-center text-blue-300 text-xs">
        진료 안내 시스템
      </footer>
    </div>
  );
}
