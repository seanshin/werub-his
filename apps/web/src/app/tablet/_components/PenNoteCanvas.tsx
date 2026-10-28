'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Pt = { x: number; y: number; p: number };
type Stroke = { tool: 'pen' | 'highlighter' | 'eraser'; color: string; base: number; points: Pt[] };

const COLORS = ['#1f2937', '#2563eb', '#dc2626'];

function ToolBtn({ on, onClick, children, danger, disabled }: { on?: boolean; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`min-h-[40px] px-3 rounded-xl text-sm font-semibold disabled:opacity-40 ${danger ? 'bg-red-50 text-red-600' : on ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-200'}`}>
      {children}
    </button>
  );
}

function drawStroke(g: CanvasRenderingContext2D, s: Stroke) {
  if (s.points.length < 2) return;
  g.save();
  g.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
  g.strokeStyle = s.color;
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1], b = s.points[i];
    g.beginPath();
    g.lineWidth = s.tool === 'highlighter' ? s.base : Math.max(1, s.base * (0.4 + b.p));
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  g.restore();
}

/** 스타일러스 스케치 캔버스 — 괘선 배경·필압·팜리젝션·스트로크 undo·PNG 내보내기·차트 저장. */
export default function PenNoteCanvas({ height = 420, onSave }: { height?: number; onSave?: (dataUrl: string) => Promise<void> | void }) {
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const cur = useRef<Stroke | null>(null);

  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [allowTouch, setAllowTouch] = useState(false);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const ctx = () => canvasRef.current?.getContext('2d') ?? null;

  const redraw = useCallback(() => {
    const c = canvasRef.current, g = ctx();
    if (!c || !g) return;
    g.clearRect(0, 0, c.width, c.height);
    for (const s of strokes.current) drawStroke(g, s);
  }, []);

  const resize = useCallback(() => {
    const c = canvasRef.current, w = wrapRef.current;
    if (!c || !w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    c.width = Math.floor(w.clientWidth * dpr);
    c.height = Math.floor(height * dpr);
    const g = ctx();
    if (g) { g.setTransform(1, 0, 0, 1, 0, 0); g.scale(dpr, dpr); g.lineCap = 'round'; g.lineJoin = 'round'; }
    redraw();
  }, [height, redraw]);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const pos = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure && e.pressure > 0 ? e.pressure : 0.5 };
  };

  const eraseAt = (pt: Pt) => {
    const before = strokes.current.length;
    strokes.current = strokes.current.filter((s) => !s.points.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < 14));
    if (strokes.current.length !== before) { redraw(); rerender(); }
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'pen' && !allowTouch) return; // 팜 리젝션: 펜만(옵션 시 손가락 허용)
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    if (tool === 'eraser') { eraseAt(pos(e)); return; }
    cur.current = { tool, color, base: tool === 'highlighter' ? 16 : 2.4, points: [pos(e)] };
  };

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'pen' && !allowTouch) return;
    if (tool === 'eraser' && e.buttons) { eraseAt(pos(e)); return; }
    if (!cur.current) return;
    cur.current.points.push(pos(e));
    const g = ctx();
    if (g) drawStroke(g, { ...cur.current, points: cur.current.points.slice(-2) });
  };

  const onUp = () => {
    if (cur.current && cur.current.points.length > 1) { strokes.current.push(cur.current); rerender(); }
    cur.current = null;
  };

  const undo = () => { strokes.current.pop(); redraw(); rerender(); };
  const clear = () => { strokes.current = []; redraw(); rerender(); };

  const composeDataUrl = (): string | null => {
    const c = canvasRef.current; if (!c) return null;
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const g = off.getContext('2d'); if (!g) return null;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, off.width, off.height);
    g.drawImage(c, 0, 0);
    return off.toDataURL('image/png');
  };

  const exportPng = () => {
    const url = composeDataUrl(); if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = 'note-sketch.png'; a.click();
  };

  const save = async () => {
    if (!onSave) return;
    const url = composeDataUrl(); if (!url) return;
    setSaving(true);
    try { await onSave(url); clear(); } finally { setSaving(false); }
  };

  const hasStrokes = strokes.current.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolBtn on={tool === 'pen'} onClick={() => setTool('pen')}>✏️ 펜</ToolBtn>
        <ToolBtn on={tool === 'highlighter'} onClick={() => setTool('highlighter')}>🖍 형광</ToolBtn>
        <ToolBtn on={tool === 'eraser'} onClick={() => setTool('eraser')}>🧽 지우개</ToolBtn>
        <span className="mx-1 flex gap-1">
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} aria-label={`색 ${c}`}
              className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-gray-800' : 'border-white'}`} style={{ background: c }} />
          ))}
        </span>
        <ToolBtn onClick={undo} disabled={!hasStrokes}>↶ 실행취소</ToolBtn>
        <ToolBtn onClick={clear} danger disabled={!hasStrokes}>전체 지우기</ToolBtn>
        <ToolBtn onClick={exportPng} disabled={!hasStrokes}>⬇ PNG</ToolBtn>
        {onSave && <ToolBtn on onClick={save} disabled={!hasStrokes || saving}>{saving ? '저장 중…' : '💾 차트에 저장'}</ToolBtn>}
        <label className="ml-1 text-xs text-gray-500 flex items-center gap-1">
          <input type="checkbox" checked={allowTouch} onChange={(e) => setAllowTouch(e.target.checked)} /> 손가락 필기
        </label>
      </div>
      <div ref={wrapRef} className="rounded-2xl border border-gray-200 shadow-inner overflow-hidden"
        style={{ background: 'repeating-linear-gradient(#fcfdff, #fcfdff 35px, #e6effa 36px)' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, display: 'block', touchAction: allowTouch ? 'none' : 'pan-y' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
      </div>
      <p className="text-xs text-gray-400">펜으로 필기·도해. 손가락은 기본 스크롤(팜 리젝션) — 필요 시 ‘손가락 필기’ 체크. {onSave ? '‘차트에 저장’으로 진료 첨부.' : ''}</p>
    </div>
  );
}
