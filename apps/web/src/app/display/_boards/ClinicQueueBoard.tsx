'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDurationText } from '@/components/ui/display';
import { FreshnessBadge } from './FreshnessBadge';
import { localeTimeText } from '@hospital-run/shared';

/**
 * 외래 진료과·진료실 대기 현황 TV 보드(공개·outpatient-clinic-queue-tv-board.plan.md).
 * - 데이터 = 기존 공개 SSE `/api/v1/queue/public/stream`(서버 마스킹·신규 공개 표면 0) + 폴링 폴백.
 * - 위계 = 과 섹션 → 진료실 카드(D3). 층별 TV 는 ?departments=내과,정형외과 필터(D2).
 * - 디자인 언어 = ER TV v2 공유(D7). 호출 시 상단 대형 배너 5초(D5).
 */

interface QueueRow {
  queueNumber: number;
  status: string;
  patientName: string; // 서버 마스킹(홍○동)
  roomName: string | null;
  doctorName: string; // 서버 마스킹
  /** 🔴 아직 오지 않은 접수 시각은 서버가 null 을 보낸다 — 종전엔 음수(`-93`)가 그대로 실려 왔다 */
  waitMinutes: number | null;
  callCount: number;
}
interface DeptData {
  name: string;
  queues: QueueRow[];
  waiting: number;
  called: number;
  inConsultation: number;
  /** 🔴 표본(진료 시작 시각 보유 건)이 없으면 서버가 null 을 보낸다 — 0 분이 아니라 '산출 불가' */
  avgWaitMinutes: number | null;
  /** 평균 대기 산출에 쓴 표본 수 */
  waitSampleN?: number;
}
interface CallEvent { departmentName: string; queueNumber: number; patientName: string; roomName: string | null; ttsText?: string }

const TTS_KEY = 'display.clinicQueue.tts';

export function ClinicQueueBoard({ departments = '', initialTts }: { departments?: string; initialTts?: boolean }) {
  const fmtDur = useDurationText();
  const deptFilter = departments;
  const [depts, setDepts] = useState<DeptData[]>([]);
  const [loaded, setLoaded] = useState(false); // 첫 목록 수신 전 '환자 없음' 오표시 방지(호출 이벤트가 먼저 올 수 있다)
  const [call, setCall] = useState<CallEvent | null>(null);
  const [clock, setClock] = useState('');
  /** 🔴 목록을 **받은** 시각. 시계(clock)는 SSE 가 죽어도 계속 돌기 때문에 최신 여부의 근거가 못 된다 */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // 음성 호출(P1) — 브라우저 자동재생 정책상 사용자 제스처 1회가 필요해 기본 OFF·설치 시 한 번 켠다(localStorage 유지)
  const [tts, setTts] = useState(false);
  useEffect(() => {
    if (initialTts !== undefined) { setTts(initialTts); return; } // 박스 지정값 우선(서버 설정)
    try { setTts(localStorage.getItem(TTS_KEY) === '1'); } catch { /* ignore */ }
  }, [initialTts]);
  const toggleTts = () => {
    const next = !tts;
    setTts(next);
    try { localStorage.setItem(TTS_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    if (next && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance('음성 안내를 시작합니다')); // 제스처 컨텍스트에서 활성화
    }
  };

  const ttsRef = useRef(false);
  useEffect(() => { ttsRef.current = tts; }, [tts]);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const qs = deptFilter ? `?departments=${encodeURIComponent(deptFilter)}` : '';
    let alive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let callTimer: ReturnType<typeof setTimeout> | null = null;

    const applyUpdate = (d: { departments?: DeptData[] } | null) => {
      if (!alive) return;
      if (d?.departments) setDepts(d.departments);
      setLoaded(true);
      setUpdatedAt(Date.now());
    };
    // 폴백 = SSE 5초 재연결(공개 REST 는 키 필요라 스트림이 유일한 공개 소스)
    const connect = () => {
      const es = new EventSource(`${apiUrl}/api/v1/queue/public/stream${qs}`);
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === 'queue-update') applyUpdate(msg.data);
          else if (msg.event === 'call' && msg.data) {
            const ev = msg.data as CallEvent;
            setCall(ev);
            // 음성 호출 — 문구는 서버 생성(ttsText·기존 buildTtsText 재사용)이라 화면·음성이 갈리지 않는다
            if (ttsRef.current && ev.ttsText && typeof window !== 'undefined' && window.speechSynthesis) {
              window.speechSynthesis.cancel();
              const u = new SpeechSynthesisUtterance(ev.ttsText);
              u.lang = 'ko-KR';
              u.rate = 0.95;
              window.speechSynthesis.speak(u);
            }
            if (callTimer) clearTimeout(callTimer);
            callTimer = setTimeout(() => setCall(null), 6000);
          }
        } catch { /* skip */ }
      };
      es.onerror = () => { es.close(); if (alive) pollTimer = setTimeout(connect, 5000) as unknown as ReturnType<typeof setInterval>; };
      return es;
    };
    const es = connect();
    const clockTimer = setInterval(() => setClock(localeTimeText(new Date(), 'ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })), 1000);
    return () => { alive = false; es.close(); if (pollTimer) clearTimeout(pollTimer as unknown as number); if (callTimer) clearTimeout(callTimer); clearInterval(clockTimer); };
  }, [deptFilter]);

  // 과 → 진료실 그룹핑(D3) — roomName 없는 대기는 '배정 대기'
  const grouped = useMemo(() => depts.map((d) => {
    const active = d.queues.filter((q) => ['WAITING', 'CALLED', 'IN_CONSULTATION'].includes(q.status));
    const rooms = new Map<string, QueueRow[]>();
    for (const q of active) {
      const room = q.roomName || '배정 대기';
      if (!rooms.has(room)) rooms.set(room, []);
      rooms.get(room)!.push(q);
    }
    const cashier = d.queues.filter((q) => q.status === 'CASHIER_WAITING').length;
    const pharmacy = d.queues.filter((q) => q.status === 'PHARMACY_WAITING').length;
    return { ...d, rooms: [...rooms.entries()], cashier, pharmacy };
  }), [depts]);

  // 🔴 종전 `(d.avgWaitMinutes || 0)` 은 **표본이 없어 null 인 과를 0 분으로 섞어** 전원 평균을 희석했다.
  //    과 4곳 중 1곳만 평균 40분이고 나머지가 미측정이면 전광판은 "평균 10분"이라 말했다(P1).
  //    평균은 **표본이 있는 과만** 낸다. 하나도 없으면 숫자를 만들지 않는다(폴백 금지).
  const sampledDepts = depts.filter((d) => d.avgWaitMinutes != null);
  const totalAvg = sampledDepts.length
    ? Math.round(sampledDepts.reduce((s, d) => s + (d.avgWaitMinutes as number), 0) / sampledDepts.length)
    : null;

  return (
    <div className="fixed inset-0 bg-[#0a0e16] text-white flex flex-col px-14 py-7 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between pb-4 border-b-2 border-gray-800">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-sky-600 flex items-center justify-center text-4xl font-black">+</div>
          <div>
            <h1 className="text-6xl font-black tracking-tight">외래 진료 현황{deptFilter ? ` — ${deptFilter.split(',').join(' · ')}` : ''}</h1>
            <p className="text-2xl text-gray-400 mt-1.5">접수 → 대기 → 호출 → 진료 → 수납·약국 순으로 진행됩니다</p>
          </div>
        </div>
        <div className="text-right flex items-center gap-6">
          <button onClick={toggleTts}
            title={tts ? '음성 호출 켜짐 — 클릭하면 끕니다' : '음성 호출 꺼짐 — 클릭하면 켭니다(설치 시 1회 필요)'}
            className={`rounded-2xl px-5 py-3 text-2xl font-bold border transition-colors ${
              tts ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-gray-800/60 border-gray-700 text-gray-500'
            }`}>
            {tts ? '🔊 음성 켜짐' : '🔇 음성 꺼짐'}
          </button>
          <div>
            <p className="text-6xl font-bold tabular-nums text-gray-100">{clock}</p>
            {/* 표본이 있는 과만 센 평균임을 밝힌다 — 전 과 평균으로 오독되면 대기 실태를 축소해 보이게 한다 */}
            {totalAvg != null && (
              <p className="text-2xl text-gray-400 mt-1">
                평균 대기 <span className="text-amber-300 font-bold">{totalAvg}분</span>
                {sampledDepts.length < depts.length && <span className="text-xl text-gray-500 ml-2">({sampledDepts.length}/{depts.length}과 기준)</span>}
              </p>
            )}
            {/* 🔴 전광판은 사람이 리로드하지 않는다 — 시계가 도는 것과 자료가 도는 것은 별개다 */}
            <FreshnessBadge updatedAt={updatedAt} staleAfterSec={20} className="block text-xl mt-1" />
          </div>
        </div>
      </div>

      {/* 호출 배너(D5) */}
      {call && (
        <div className="mt-4 rounded-3xl bg-amber-400 text-gray-950 px-10 py-5 flex items-center gap-8 animate-pulse">
          <span className="text-5xl">🔔</span>
          <span className="text-5xl font-black tabular-nums">{call.queueNumber}번</span>
          <span className="text-5xl font-black">{call.patientName} 님</span>
          <span className="text-4xl font-bold ml-auto">{call.roomName ? `${call.departmentName} · ${call.roomName}으로` : `${call.departmentName} 접수 창구로`} 와주세요</span>
        </div>
      )}

      {/* 과 섹션 */}
      <div className="flex-1 overflow-hidden mt-5 space-y-6">
        {grouped.length === 0 && (
          <p className="text-4xl text-gray-500 text-center mt-28">{loaded ? '현재 대기 중인 환자가 없습니다' : '대기 현황을 불러오는 중입니다…'}</p>
        )}
        {grouped.slice(0, 2).map((d) => (
          <div key={d.name}>
            <div className="flex items-baseline gap-5 mb-3">
              <h2 className="text-4xl font-black">{d.name}</h2>
              <span className="text-2xl text-gray-400">대기 <b className="text-white">{d.waiting}</b> · 진료중 <b className="text-emerald-300">{d.inConsultation}</b>{d.avgWaitMinutes != null && d.avgWaitMinutes > 0 && <> · 평균 대기 <b className="text-amber-300">{fmtDur(d.avgWaitMinutes)}</b></>}</span>
              {(d.cashier > 0 || d.pharmacy > 0) && (
                <span className="ml-auto text-xl text-gray-500">수납 대기 {d.cashier} · 약국 대기 {d.pharmacy}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-5">
              {d.rooms.slice(0, 4).map(([room, rows]) => {
                const inRoom = rows.find((q) => q.status === 'IN_CONSULTATION');
                const called = rows.find((q) => q.status === 'CALLED');
                const waiting = rows.filter((q) => q.status === 'WAITING');
                const doctor = rows.find((q) => q.doctorName)?.doctorName;
                return (
                  <div key={room} className="rounded-3xl border border-gray-700/80 bg-gray-900/70 px-8 py-6">
                    <div className="flex items-baseline justify-between">
                      <p className="text-3xl font-bold text-sky-300">{room}{doctor ? <span className="text-2xl text-gray-400 font-medium"> · {doctor}</span> : null}</p>
                      <span className="text-xl text-gray-500">대기 {waiting.length}</span>
                    </div>
                    <div className="mt-4 min-h-[64px]">
                      {called ? (
                        <p className="text-4xl font-black text-amber-300 animate-pulse">🔔 호출 {called.queueNumber}번 {called.patientName}{called.callCount > 1 ? ` (${called.callCount}회)` : ''}</p>
                      ) : inRoom ? (
                        <p className="text-4xl font-black text-emerald-300">진료 중 · {inRoom.queueNumber}번 {inRoom.patientName}</p>
                      ) : (
                        <p className="text-3xl text-gray-600">대기 접수 중</p>
                      )}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {waiting.slice(0, 4).map((q) => (
                        <div key={q.queueNumber} className="flex items-center gap-4 text-2xl">
                          <span className="font-bold tabular-nums w-20">{q.queueNumber}번</span>
                          <span className="text-gray-200">{q.patientName}</span>
                          <span className="ml-auto text-amber-300/90 tabular-nums">⏱ {fmtDur(q.waitMinutes)}</span>
                        </div>
                      ))}
                      {waiting.length > 4 && <p className="text-xl text-gray-500">외 {waiting.length - 4}명 대기</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {grouped.length > 2 && (
          <p className="text-2xl text-gray-500">외 {grouped.length - 2}개 진료과 진행 중 — 해당 층 안내 화면을 확인해 주세요</p>
        )}
      </div>

      <p className="pt-3 text-lg text-gray-600 border-t border-gray-800">
        개인정보 보호를 위해 성명은 일부만 표시됩니다 · 자세한 안내는 접수 창구에 문의해 주세요
      </p>
    </div>
  );
}
