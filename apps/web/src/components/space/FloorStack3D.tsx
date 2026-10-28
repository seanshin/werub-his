'use client';

/**
 * 층 적층 3D 보기 — CSS 3D 변환으로 층 평면도를 쌓는다(외부 3D 라이브러리 없음). 기획 spatial-flow-vision-3d P2.
 *
 * 🔴 왜 WebGL(three.js)이 아닌가: 새 의존성은 서버 `npm ci`(사람 허가 대기)가 필요하고 배포 스크립트가 설치하지 않는다.
 *    CSS 3D 로도 층 적층·회전·선택은 된다. 3D 는 **보조 보기**다 — 정보는 전부 2D 평면도에도 있다(3D 전용 정보 없음).
 * 🔴 모든 층을 같은 틀(frame)로 그려 코어(엘리베이터·계단)가 위아래로 정렬된다.
 *
 * 표현(2026-09-28 재구성): 어두운 무대 · 두께 있는 층판(옆면 4장) · 층 이름표 · 선택한 층을 들어 올리고 나머지는 흐리게 ·
 * 시점 프리셋(비스듬히/위에서/앞에서) · 층 간격은 층 수에 맞춰 무대 안에 들어가게.
 */
import { useRef, useState } from 'react';
import { T } from '@/components/ui/i18n-text';
import { FloorPlanSvg, type GeoFloor, type HeatLevel } from './FloorPlanSvg';

const VIEWS = {
  iso: { rot: -32, tilt: 56 },
  top: { rot: 0, tilt: 8 },
  side: { rot: -8, tilt: 76 },
} as const;
type ViewKey = keyof typeof VIEWS;

/** 층판 두께(px) */
const SLAB = 10;

export function FloorStack3D({
  floors,
  selectedKey,
  onSelectFloor,
  notice,
  patients,
  showInferred,
  heat,
  routeByFloor,
}: {
  floors: GeoFloor[];
  selectedKey: string | null;
  onSelectFloor: (key: string) => void;
  notice?: string | null;
  patients?: Map<string, { observed: number; inferred: number }>;
  showInferred?: boolean;
  heat?: Map<string, HeatLevel>;
  routeByFloor?: Map<string, [number, number][]>;
}) {
  const [rot, setRot] = useState<number>(VIEWS.iso.rot);
  const [tilt, setTilt] = useState<number>(VIEWS.iso.tilt);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; rot: number; tilt: number } | null>(null);
  const frame = {
    w: Math.max(...floors.map((f) => f.footprint.x + f.footprint.w)),
    h: Math.max(...floors.map((f) => f.footprint.y + f.footprint.h)),
  };
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  // 층 간격 — 층이 많으면 좁힌다(무대 밖으로 잘리지 않게)
  const GAP = Math.max(30, Math.min(64, 260 / Math.max(1, sorted.length - 1)));
  // 선택한 층 위쪽을 벌리는 높이(px) — 위층 판이 선택 층을 덮지 않게(분해도처럼)
  const LIFT = 90;
  const selIdx = sorted.findIndex((f) => f.key === selectedKey);
  const stackH = (sorted.length - 1) * GAP + (selIdx >= 0 ? LIFT : 0);
  // 시점 중심 = 선택 층(없으면 쌓은 높이의 가운데) — 낮은 층을 골라도 무대 가운데에 온다
  const focusZ = selIdx >= 0 ? selIdx * GAP + LIFT * 0.35 : stackH / 2;
  const setView = (v: ViewKey) => { setRot(VIEWS[v].rot); setTilt(VIEWS[v].tilt); };

  return (
    <div
      className="relative h-[600px] w-full select-none overflow-hidden rounded-2xl border border-slate-800"
      style={{ background: 'radial-gradient(ellipse at 50% 35%, #1e293b 0%, #0f172a 55%, #020617 100%)', perspective: '1800px', touchAction: 'none' }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        drag.current = { x: e.clientX, y: e.clientY, rot, tilt };
        setDragging(true);
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        setRot(d.rot + (e.clientX - d.x) * 0.3);
        setTilt(Math.min(82, Math.max(0, d.tilt - (e.clientY - d.y) * 0.25)));
      }}
      onPointerUp={() => { drag.current = null; setDragging(false); }}
      aria-label="3D"
    >
      {/* 무대 격자(바닥) */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: 'linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{
            width: 'min(560px, 68%)',
            aspectRatio: `${frame.w + 4} / ${frame.h + 4}`,
            transformStyle: 'preserve-3d',
            // 쌓인 높이의 절반만큼 내려 무대 가운데에 오게
            transform: `translateY(24px) rotateX(${tilt}deg) rotateZ(${rot}deg) translateZ(${-focusZ}px)`,
            transition: dragging ? undefined : 'transform 0.45s cubic-bezier(.2,.8,.2,1)',
          }}
        >
          {/* 바닥 그림자 */}
          <div className="pointer-events-none absolute -inset-[12%] rounded-[50%]"
            style={{ transform: 'translateZ(-24px)', background: 'radial-gradient(closest-side, rgba(0,0,0,0.55), transparent)' }} />
          {sorted.map((f, i) => {
            const sel = selectedKey === f.key;
            const dim = selectedKey != null && !sel;
            const above = selIdx >= 0 && i > selIdx;
            const z = i * GAP + (above ? LIFT : 0);
            // 이 층의 실제 외곽(틀 대비 %) — 판 옆면·이름표를 외곽에 맞춘다(위층이 작아도 틀 전체를 흰 판으로 그리지 않게)
            const VW = frame.w + 4, VH = frame.h + 4;
            const box = {
              left: `${((f.footprint.x + 2) / VW) * 100}%`, top: `${((f.footprint.y + 2) / VH) * 100}%`,
              width: `${(f.footprint.w / VW) * 100}%`, height: `${(f.footprint.h / VH) * 100}%`,
            };
            return (
              <div
                key={f.key}
                className="absolute inset-0"
                style={{
                  transform: `translateZ(${z}px)`,
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.45s cubic-bezier(.2,.8,.2,1)',
                }}
                onDoubleClick={() => onSelectFloor(f.key)}
              >
                {/* 옆면 4장 — 판 두께(이 층 외곽에) */}
                <div className="pointer-events-none absolute" style={{ ...box, transformStyle: 'preserve-3d' }}>
                {([
                  { w: '100%', h: SLAB, t: `translateY(-${SLAB}px) rotateX(90deg)`, o: 'bottom', pos: { left: 0, top: 0 }, c: '#94a3b8' },
                  { w: '100%', h: SLAB, t: 'rotateX(-90deg)', o: 'top', pos: { left: 0, bottom: -SLAB }, c: '#64748b' },
                  { w: SLAB, h: '100%', t: `translateX(-${SLAB}px) rotateY(-90deg)`, o: 'right', pos: { left: 0, top: 0 }, c: '#7c8aa0' },
                  { w: SLAB, h: '100%', t: 'rotateY(90deg)', o: 'left', pos: { right: -SLAB, top: 0 }, c: '#546176' },
                ] as const).map((face, k) => (
                  <div key={k} className="pointer-events-none absolute"
                    style={{ width: face.w, height: face.h, ...face.pos, transform: face.t, transformOrigin: face.o, background: sel ? '#6366f1' : face.c, opacity: above ? 0.12 : dim ? 0.4 : 1 }} />
                ))}
                </div>
                {/* 윗면 — 평면도 */}
                <div className="absolute inset-0"
                  style={{
                    opacity: above ? 0.18 : dim ? 0.55 : 1,
                    // 선택 층은 외곽을 따라 빛나게(판 모양대로) · 나머지는 채도를 낮춘다
                    filter: sel ? 'drop-shadow(0 0 3px #818cf8) drop-shadow(0 0 14px rgba(99,102,241,0.6))' : dim ? 'saturate(0.35)' : undefined,
                    transition: 'opacity 0.3s',
                  }}>
                  <FloorPlanSvg
                    floor={f}
                    frame={frame}
                    labels={sel}
                    notice={sel ? notice : null}
                    patients={patients}
                    showInferred={showInferred}
                    heat={heat}
                    route={routeByFloor?.get(f.key)}
                  />
                </div>
                {/* 층 이름표 — 판 왼쪽 앞 모서리 */}
                <div className="pointer-events-none absolute flex -translate-x-full -translate-y-1/2 items-center gap-1.5 whitespace-nowrap pr-2"
                  style={{ left: box.left, top: `calc(${box.top} + ${box.height} / 2)`, opacity: above ? 0.35 : dim ? 0.6 : 1 }}>
                  <span className={`rounded-md px-2 py-0.5 text-[13px] font-bold ${sel ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-100'}`}>{f.key}</span>
                  {sel && <span className="text-[11px] font-medium text-indigo-200">{f.title}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 시점 프리셋 */}
      <div className="absolute left-3 top-3 flex overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
        {(['iso', 'top', 'side'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className="min-h-[36px] px-3 text-[11px] font-medium text-slate-200 hover:bg-white/10">
            {v === 'iso' ? <T k="비스듬히" /> : v === 'top' ? <T k="위에서" /> : <T k="앞에서" />}
          </button>
        ))}
      </div>

      {/* 층 패널 — 엘리베이터처럼 위층이 위 */}
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-white/10 bg-white/5 p-1.5 backdrop-blur">
        {[...sorted].reverse().map((f) => (
          <button key={f.key} onClick={() => onSelectFloor(f.key)} aria-pressed={selectedKey === f.key}
            className={`min-h-[40px] min-w-[48px] rounded-xl text-xs font-bold transition ${selectedKey === f.key ? 'bg-indigo-500 text-white shadow-[0_0_16px_rgba(99,102,241,0.7)]' : 'text-slate-300 hover:bg-white/10'}`}>
            {f.key}
          </button>
        ))}
      </div>
    </div>
  );
}
