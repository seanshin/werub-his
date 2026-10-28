'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getMarksForPath, CERT_CATEGORY_META, type CertCategory } from '@/lib/certification-marks';

/**
 * 인증마크 배지 — 화면 우하단 고정.
 * 현재 화면이 충족하는 의료 인증 표준(EMR인증/JCI/인증평가/의료법/개인정보)을 표시.
 * 기본은 접힌 칩, 클릭 시 상세 패널 펼침. 사용자가 닫으면 세션 동안 숨김.
 */
export function CertificationBadge() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  // 경로 변경 시 패널 접기
  useEffect(() => { setOpen(false); }, [pathname]);

  // 세션 내 사용자 숨김 설정 복원
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('cert-badge-hidden') === '1') setHidden(true);
  }, []);

  const marks = getMarksForPath(pathname || '');
  if (hidden || marks.length === 0) return null;

  // 카테고리별 그룹화
  const byCategory = marks.reduce<Record<string, typeof marks>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});
  const categories = Object.keys(byCategory) as CertCategory[];

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="px-3.5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
            <span className="text-xs font-bold flex items-center gap-1.5">🛡️ 이 화면의 인증 준수</span>
            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white text-sm leading-none">✕</button>
          </div>
          <div className="max-h-80 overflow-y-auto p-3 space-y-3">
            {categories.map((cat) => (
              <div key={cat}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${CERT_CATEGORY_META[cat].dot}`} />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{CERT_CATEGORY_META[cat].label}</span>
                </div>
                <div className="space-y-1.5">
                  {byCategory[cat].map((m) => (
                    <div key={m.code} className={`rounded-lg border px-2.5 py-1.5 ${CERT_CATEGORY_META[cat].cls}`}>
                      <p className="text-[11px] font-semibold leading-tight">{m.label}</p>
                      <p className="text-[10px] opacity-80 leading-snug mt-0.5">{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={() => { sessionStorage.setItem('cert-badge-hidden', '1'); setHidden(true); }}
              className="w-full text-[10px] text-gray-400 hover:text-gray-600 pt-1"
            >
              이 세션에서 인증마크 숨기기
            </button>
          </div>
        </div>
      )}

      {/* 접힌 칩 — 카테고리 색 점 + 개수 */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="이 화면이 충족하는 의료 인증 표준 보기"
        className="flex items-center gap-1.5 bg-white/95 backdrop-blur border border-gray-200 rounded-full pl-2.5 pr-3 py-1.5 shadow-lg hover:shadow-xl transition-shadow"
      >
        <span className="text-sm">🛡️</span>
        <span className="flex items-center gap-0.5">
          {categories.map((cat) => (
            <span key={cat} className={`w-1.5 h-1.5 rounded-full ${CERT_CATEGORY_META[cat].dot}`} />
          ))}
        </span>
        <span className="text-[11px] font-semibold text-gray-700">인증 {marks.length}</span>
      </button>
    </div>
  );
}
