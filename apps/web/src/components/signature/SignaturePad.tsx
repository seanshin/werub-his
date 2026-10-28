'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';

export interface SignaturePadHandle {
  toDataURL: () => string | null;  // 서명 있으면 PNG dataURL, 없으면 null
  clear: () => void;
  isEmpty: () => boolean;
}

/**
 * 캔버스 기반 필기 서명패드 (마우스/터치/펜).
 * 부모는 ref로 toDataURL()/clear()/isEmpty() 호출.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number; onChange?: (empty: boolean) => void }>(
  function SignaturePad({ height = 200, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const dirty = useRef(false);
    const [empty, setEmpty] = useState(true);

    useImperativeHandle(ref, () => ({
      toDataURL: () => (dirty.current ? canvasRef.current?.toDataURL('image/png') ?? null : null),
      clear: () => {
        const c = canvasRef.current; if (!c) return;
        const ctx = c.getContext('2d'); ctx?.clearRect(0, 0, c.width, c.height);
        dirty.current = false; setEmpty(true); onChange?.(true);
      },
      isEmpty: () => !dirty.current,
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // 고해상도 대응
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';

      const pos = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const down = (e: PointerEvent) => {
        e.preventDefault();
        drawing.current = true;
        const { x, y } = pos(e);
        ctx.beginPath(); ctx.moveTo(x, y);
        canvas.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!drawing.current) return;
        const { x, y } = pos(e);
        ctx.lineTo(x, y); ctx.stroke();
        if (!dirty.current) { dirty.current = true; setEmpty(false); onChange?.(false); }
      };
      const up = () => { drawing.current = false; };

      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return () => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
    }, [height, onChange]);

    const clear = () => {
      const c = canvasRef.current; if (!c) return;
      c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      dirty.current = false; setEmpty(true); onChange?.(true);
    };

    return (
      <div className="relative">
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none' }}
          className="w-full bg-white border-2 border-dashed border-gray-300 rounded-xl cursor-crosshair"
        />
        {empty && (
          <span className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm pointer-events-none">
            여기에 서명해주세요
          </span>
        )}
        <button onClick={clear} type="button" className="absolute top-2 right-2 px-2.5 py-1 text-[11px] bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200">지우기</button>
      </div>
    );
  },
);
