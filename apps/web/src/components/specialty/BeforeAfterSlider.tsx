'use client';

import { useState, useRef, useCallback } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BeforeAfterSliderProps {
  beforeUrl?: string;
  afterUrl?: string;
  beforeLabel?: string;
  afterLabel?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Before',
  afterLabel = 'After',
}: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(50); // percentage
  const tAttr = useTAttr();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPosition(pct);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updatePosition(e.clientX);
    },
    [updatePosition],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      updatePosition(e.clientX);
    },
    [updatePosition],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const placeholderBox = (label: React.ReactNode) => (
    <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );

  return (
    <div className="w-full max-w-[560px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-3 text-center"><T k="전후 비교 (Before / After)" /></p>

      <div
        ref={containerRef}
        className="relative w-full aspect-[4/3] overflow-hidden rounded-xl border border-gray-200 select-none touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        aria-label={tAttr('전후 비교 슬라이더')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPosition((p) => Math.max(0, p - 2));
          if (e.key === 'ArrowRight') setPosition((p) => Math.min(100, p + 2));
        }}
      >
        {/* After (full background) */}
        {afterUrl ? (
          <img
            src={afterUrl}
            alt={afterLabel}
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          placeholderBox(<>{afterLabel} (<T k="이미지 없음" />)</>)
        )}

        {/* Before (clipped by slider position) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${position}%` }}
        >
          {beforeUrl ? (
            <img
              src={beforeUrl}
              alt={beforeLabel}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ width: `${containerRef.current?.offsetWidth ?? 560}px`, maxWidth: 'none' }}
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 bg-gray-200 flex items-center justify-center" style={{ width: `${containerRef.current?.offsetWidth ?? 560}px` }}>
              <span className="text-sm text-gray-500">{beforeLabel} (<T k="이미지 없음" />)</span>
            </div>
          )}
        </div>

        {/* Divider line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
          style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        />

        {/* Handle */}
        <div
          className="absolute top-1/2 w-8 h-8 rounded-full bg-white shadow-lg border-2 border-blue-500 flex items-center justify-center"
          style={{
            left: `${position}%`,
            transform: 'translate(-50%, -50%)',
            cursor: 'ew-resize',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 1L1 6L4 11" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M8 1L11 6L8 11" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>

        {/* Labels */}
        <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/50 text-white whitespace-nowrap">
          {beforeLabel}
        </span>
        <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/50 text-white whitespace-nowrap">
          {afterLabel}
        </span>
      </div>

      <p className="text-center text-[10px] text-gray-400 mt-1"><T k="드래그하여 비교 (좌우 화살표 키 사용 가능)" /></p>
    </div>
  );
}
