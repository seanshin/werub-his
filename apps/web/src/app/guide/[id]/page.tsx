'use client';

import { useEffect, useState, use } from 'react';
import type { RouteStep } from '@hospital-run/shared';
import type { GeoFloor } from '@/components/space/FloorPlanSvg';
import { RouteFloorPlans } from '@/components/space/RouteFloorPlans';
import { RouteSteps } from '@/components/space/RouteSteps';

/** 길안내 응답(P3) — 경로를 못 구하면 reason 만 온다(직선·추정 경로를 그리지 않는다) */
interface GuideRoute {
  available: boolean;
  reason?: string;
  notice?: string | null;
  walkM?: number;
  steps?: RouteStep[];
  segments?: { floor: string; points: [number, number][] }[];
  /** 통제 구역은 빠져 온다 — 층마다 뺀 수 */
  floors?: (GeoFloor & { restrictedHidden?: number })[];
  targetSpaceNodeId?: string;
  entrances: { id: string; name: string; floor: string; main: boolean }[];
}
const ROUTE_REASON: Record<string, string> = {
  ROOM_NOT_LINKED: '이 진료실은 아직 위치가 등록되지 않았습니다. 안내 데스크에 문의해 주세요.',
  ROOM_NOT_ASSIGNED: '진료실이 아직 배정되지 않았습니다.',
  NO_GEOMETRY: '병원 도면이 아직 준비되지 않았습니다.',
  TARGET_NOT_IN_DRAWING: '이 진료실은 도면에 없습니다. 안내 데스크에 문의해 주세요.',
  START_UNKNOWN: '출발 위치를 찾을 수 없습니다.',
  NO_PATH: '경로를 찾지 못했습니다. 안내 데스크에 문의해 주세요.',
};

function RouteSection({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [accessible, setAccessible] = useState(false);
  const [r, setR] = useState<GuideRoute | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const qs = new URLSearchParams({ ...(from ? { origin: from } : {}), ...(accessible ? { accessible: '1' } : {}) });
    fetch(`/api/v1/guide/${id}/route?${qs}`).then((x) => x.json()).then((j) => { if (active) { setR(j.data ?? null); setFailed(!j.data); } })
      .catch(() => active && setFailed(true)); // 🔴 실패는 "경로 없음"이 아니다 — 따로 말한다
    return () => { active = false; };
  }, [open, from, accessible, id]);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 w-full rounded-2xl border border-blue-200 bg-white py-3 text-sm font-semibold text-blue-700">
        🧭 진료실까지 길 안내
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-3 rounded-3xl border border-gray-100 bg-white p-4 text-left shadow-lg">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select className="min-h-[40px] flex-1 rounded-lg border px-2" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="출발 위치">
          <option value="">{(r?.entrances.find((e) => e.main)?.name ?? '주출입구')}에서 출발</option>
          {(r?.entrances ?? []).filter((e) => !e.main).map((e) => <option key={e.id} value={e.id}>{e.floor} {e.name}에서 출발</option>)}
        </select>
        <label className="flex min-h-[40px] items-center gap-1"><input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} />휠체어·유모차(엘리베이터만)</label>
      </div>
      {failed && <p className="text-sm text-red-600">길 안내를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}
      {!failed && !r && <p className="text-sm text-gray-400">경로를 찾는 중...</p>}
      {r && !r.available && <p className="text-sm text-amber-700">{ROUTE_REASON[r.reason ?? ''] ?? '길 안내를 할 수 없습니다.'}</p>}
      {r?.available && (
        <>
          {r.notice && <p className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">{r.notice}</p>}
          <p className="text-xs text-gray-500">걷는 거리 약 {r.walkM}m{accessible ? ' · 엘리베이터 경로' : ''}</p>
          <RouteSteps steps={r.steps ?? []} />
          <RouteFloorPlans segments={r.segments ?? []} floors={r.floors ?? []} notice={r.notice} targetSpaceNodeId={r.targetSpaceNodeId} />
        </>
      )}
    </div>
  );
}

interface Guide {
  queueNumber: number; status: string; departmentName: string; roomName?: string | null;
  /** 진료실이 공간에 연결된 경우만(층·구역) — 미연결이면 null(층을 지어내지 않는다) */
  roomLocation?: { zoneName: string; floorLabel: string | null } | null;
  doctorName?: string | null; patientName?: string | null; aheadCount: number; visitType?: string;
}
const STATUS: Record<string, { label: string; cls: string; desc: string }> = {
  WAITING: { label: '대기 중', cls: 'bg-amber-100 text-amber-700', desc: '진료 순서를 기다려 주세요' },
  CALLED: { label: '호출됨', cls: 'bg-blue-100 text-blue-700', desc: '진료실로 들어가 주세요' },
  IN_CONSULTATION: { label: '진료 중', cls: 'bg-emerald-100 text-emerald-700', desc: '진료가 진행 중입니다' },
  COMPLETED: { label: '진료 완료', cls: 'bg-gray-100 text-gray-600', desc: '수납·다음 안내를 확인하세요' },
  CANCELLED: { label: '취소됨', cls: 'bg-red-100 text-red-600', desc: '' },
};

export default function GuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [g, setG] = useState<Guide | null>(null);
  const [err, setErr] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let active = true;
    // 🔴 만료(410)와 부존재를 갈라서 말한다 — 어제 QR 을 찍은 환자에게 "찾을 수 없습니다"는 사실이 아니다
    const load = () => fetch(`/api/v1/guide/${id}`).then(async (r) => ({ status: r.status, j: await r.json() })).then(({ status, j }) => {
      if (!active) return;
      if (j.data) { setG(j.data); setErr(false); setExpired(false); return; }
      setExpired(status === 410);
      setErr(true);
    }).catch(() => active && setErr(true));
    load();
    const t = setInterval(load, 10000);
    return () => { active = false; clearInterval(t); };
  }, [id]);

  const st = g ? (STATUS[g.status] ?? { label: g.status, cls: 'bg-gray-100 text-gray-600', desc: '' }) : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-1">🏥</div>
          <h1 className="text-lg font-bold text-gray-900">진료 안내</h1>
          <p className="text-xs text-gray-500">위루비병원</p>
        </div>

        {err && !g && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-sm text-gray-400">
            {expired ? <>지난 접수의 안내입니다.<br />오늘 접수 후 다시 스캔해 주세요.</> : <>접수 정보를 찾을 수 없습니다.<br />접수 데스크에 문의해 주세요.</>}
          </div>
        )}

        {g && st && (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-lg p-6 text-center">
            {g.patientName && <p className="text-sm text-gray-500 mb-1">{g.patientName} 님</p>}
            <p className="text-xs text-gray-400">대기번호</p>
            <p className="text-6xl font-extrabold text-blue-600 my-1 tracking-tight">{g.queueNumber}</p>
            <span className={`inline-block text-xs font-semibold px-3 py-1 rounded-full ${st.cls}`}>{st.label}</span>

            <div className="mt-5 bg-blue-50 rounded-2xl p-4 text-left space-y-1.5">
              <Row label="진료과" value={g.departmentName} />
              {g.roomName && <Row label="진료실" value={g.roomName} />}
              {g.roomLocation && <Row label="위치" value={[g.roomLocation.floorLabel, g.roomLocation.zoneName].filter(Boolean).join(' ')} />}
              {g.doctorName && <Row label="담당의" value={`${g.doctorName} 선생님`} />}
              {g.status === 'WAITING' && <Row label="내 앞 대기" value={`${g.aheadCount}명`} highlight />}
            </div>

            <p className="mt-4 text-sm font-medium text-gray-700">
              {g.status === 'WAITING' && g.roomName ? `${g.roomName} 앞에서 대기해 주세요` : st.desc}
            </p>

            <RouteSection id={id} />

            <a href="/portal" className="mt-5 inline-block w-full py-3 rounded-2xl bg-blue-600 text-white text-sm font-semibold">
              환자 포털 열기 (검사결과·수납·예약)
            </a>
            <p className="text-[10px] text-gray-300 mt-3">10초마다 자동 갱신</p>
          </div>
        )}

        {!g && !err && <div className="bg-white rounded-2xl p-8 text-center text-sm text-gray-400 animate-pulse">불러오는 중...</div>}
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold ${highlight ? 'text-blue-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}
