'use client';

import { useState, useEffect } from 'react';
import { cmsResolveStyle } from '@hospital-run/shared';

/**
 * 히어로 슬라이더 (web 앱 `(homepage)` 그룹).
 *
 * 🔴 2026-08-21: 이 파일은 apps/homepage 가 W9 에서 CMS 배너를 받도록 고쳐진 뒤에도
 *    **이미지 5장 하드코딩 그대로**였다 — 같은 화면의 정본이 둘이었고 한쪽만 살아 있었다.
 *    apps/homepage 판과 같은 동작으로 맞춘다(표현은 shared `cmsResolveStyle` 정본).
 *
 * 🔴 W9(관리 화면과 방문자 화면이 다름): 이 컴포넌트가 이미지 5장을 하드코딩하고 있어서,
 *    관리자가 CMS BANNER 카테고리에 등록한 배너(운영 실측 3건: HERO 2 · STRIP 1)가
 *    공개 사이트 어디에도 나오지 않았다(소비자 0). 관리 화면에서는 "등록됨"으로 보이는데
 *    방문자는 영원히 옛 이미지를 본다 — 등록≠노출.
 *    → CMS 배너가 있으면 그것을 쓰고, 없을 때만 정적 이미지로 떨어진다.
 *
 * 🔴 2026-08-21: 이미지 없는 배너를 `backgroundColor` 단색 위 **밑줄 링크**로 그리고 있었다.
 *    운영 배너 3건 모두 `image_url` 이 비어 있어 **사이트 첫 화면이 실제로 그 모습**이었다
 *    (CMS 배너가 있는 한 예쁜 정적 사진 5장은 영영 나오지 않는다).
 *    → 표현 정본 `cmsResolveStyle` 로 **그라디언트 + 타이포 스케일 + 필(pill) 버튼**을 그린다.
 *    색은 편집자가 프리셋으로 고르고, 직접 지정 hex 도 같은 색의 명도 차로 깊이를 만든다.
 */

/** CMS 가 비어 있을 때만 쓰는 기본 이미지 */
const FALLBACK_IMAGES = [
  '/images/homepage/banners/banner-1.png',
  '/images/homepage/facilities/facility-operating-room.png',
  '/images/homepage/facilities/facility-lab.png',
  '/images/homepage/centers/center-cancer.png',
  '/images/homepage/facilities/facility-mri.png',
];

export interface HeroBanner {
  id: string;
  title: string;
  imageUrl: string | null;
  metadata?: {
    bgColor?: string;
    textColor?: string;
    stylePreset?: string;
    linkUrl?: string;
    linkText?: string;
    displayOrder?: number;
  };
}

export function HeroSlider({ banners = [] }: { banners?: HeroBanner[] }) {
  // CMS 배너 우선. 표본이 없을 때만 정적 이미지.
  const slides: HeroBanner[] = banners.length > 0
    ? [...banners].sort((a, b) => (a.metadata?.displayOrder ?? 0) - (b.metadata?.displayOrder ?? 0))
    : FALLBACK_IMAGES.map((src, i) => ({ id: `fallback-${i}`, title: '', imageUrl: src }));

  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => setCurrent(c => (c + 1) % slides.length), 5000);
    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <>
      {slides.map((s, i) => {
        const active = i === current;
        if (s.imageUrl) {
          return (
            <img
              key={s.id}
              src={s.imageUrl}
              alt={s.title || ''}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${active ? 'opacity-40' : 'opacity-0'}`}
            />
          );
        }

        // 이미지가 없을 때 — 단색이 아니라 브랜드 그라디언트 위에 타이포 스케일과 버튼을 놓는다.
        const st = cmsResolveStyle(s.metadata);
        return (
          <div
            key={s.id}
            aria-hidden={!active}
            className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ease-out ${active ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            style={{ backgroundImage: st.gradient, backgroundColor: st.bg, color: st.text }}
          >
            {/* 은은한 비네트 — 평면적인 색면에 깊이를 준다 */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ backgroundImage: 'radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 55%), radial-gradient(100% 80% at 50% 110%, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 60%)' }}
            />
            <div
              className={`relative h-full flex flex-col items-center justify-center gap-4 px-6 text-center transition-transform duration-[1200ms] ease-out ${active ? 'translate-y-0' : 'translate-y-2'}`}
            >
              <h2 className="max-w-2xl text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-[1.2] text-balance drop-shadow-sm">
                {s.title}
              </h2>
              {s.metadata?.linkUrl && s.metadata?.linkText && (
                <a
                  href={s.metadata.linkUrl}
                  className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold shadow-lg shadow-black/10 transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ backgroundColor: st.accent, color: st.accentText }}
                >
                  {s.metadata.linkText}
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        );
      })}

      {/* 인디케이터 */}
      {slides.length > 1 && (
        <div className="absolute bottom-6 right-8 flex gap-2 z-10">
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrent(i)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${i === current ? 'bg-white w-6' : 'bg-white/40 hover:bg-white/60'}`}
              aria-label={s.title ? `배너: ${s.title}` : `배너 ${i + 1}`}
            />
          ))}
        </div>
      )}
    </>
  );
}
