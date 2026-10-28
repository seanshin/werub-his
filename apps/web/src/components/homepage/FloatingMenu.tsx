'use client';

import Link from 'next/link';
import { HOSPITAL } from './hospital-facts';

export function FloatingMenu() {
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 sm:hidden">
      <div className="flex items-center gap-2 bg-white/85 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/40 px-2.5 py-2">
        {/* 🔴 W9: 모바일 플로팅 '전화' 버튼이 플레이스홀더 02-1234-5678 로 걸려 있었다(전 공개 페이지). */}
        <a
          href={`tel:${HOSPITAL.phone}`}
          aria-label={`대표전화 ${HOSPITAL.phone}`}
          className="flex items-center gap-1.5 px-5 py-3 bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-md"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          전화
        </a>
        <Link
          href="/booking"
          className="flex items-center gap-1.5 px-5 py-3 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-md"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          예약
        </Link>
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center justify-center w-11 h-11 text-gray-500 rounded-xl hover:bg-gray-100 transition"
          aria-label="맨 위로"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
