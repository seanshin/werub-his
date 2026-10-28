'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PORTAL_URL } from '@/lib/site-info';

// 비한국어는 언어별 전용 랜딩페이지로 이동(전체 사이트 번역 대신)
const LANG_LANDING: { v: string; l: string; href: string }[] = [
  { v: 'ko', l: '한국어', href: '/' },
  { v: 'en', l: 'English', href: '/en' },
  { v: 'zh', l: '中文', href: '/zh' },
  { v: 'ja', l: '日本語', href: '/ja' },
];

const MENU = [
  { label: '우리들 이야기', href: '/about', children: [
    { label: '인사말·비전', href: '/about/hospital-overview' },
    { label: '시설 안내', href: '/about/facility' },
    { label: '오시는 길', href: '/about/directions' },
    { label: '갤러리', href: '/about/gallery' },
  ]},
  { label: '진료과/의료진', href: '/care', children: [
    { label: '진료과 소개', href: '/care/departments' },
    { label: '의료진 소개', href: '/care/doctors' },
    { label: '진료시간·예약', href: '/care/schedule' },
  ]},
  // 특성화 센터 하위는 실제 운영 센터(/api/v1/public/centers)로 동적 채움 — slug 드리프트(링크깨짐) 방지.
  //   아래는 fetch 실패 시 fallback(실 5개 센터). 동적 동기화로 재발 방지.
  { label: '특성화 센터', href: '/care/centers', children: [
    { label: '심혈관센터', href: '/care/centers/cardiovascular-center' },
    { label: '암센터', href: '/care/centers/cancer-center' },
    { label: '관절·척추센터', href: '/care/centers/joint-spine-center' },
    { label: '건강검진센터', href: '/care/centers/checkup-center' },
    { label: '인공신장센터', href: '/care/centers/dialysis-center' },
  ]},
  { label: '건강증진 센터', href: '/checkup', children: [
    { label: '검진 프로그램', href: '/checkup' },
    { label: '검진 절차·준비', href: '/checkup/process' },
    { label: '검진 FAQ', href: '/checkup/faq' },
  ]},
  { label: '이용안내', href: '/guide', children: [
    { label: '입원 안내', href: '/guide/admission' },
    { label: '면회 안내', href: '/guide/visiting' },
    { label: '주차 안내', href: '/guide/parking' },
    { label: '편의시설', href: '/guide/dining' },
    { label: '장례식장', href: '/guide/funeral' },
    { label: '환자 권리·의무', href: '/guide/rights' },
    { label: '전자문서 보안', href: '/guide/document-security' },
  ]},
  { label: '건강정보', href: '/health-info', children: [] },
  { label: '병원소식', href: '/news', children: [
    { label: '공지사항', href: '/news?type=NOTICE' },
    { label: '언론보도', href: '/news?type=PRESS' },
    { label: '채용정보', href: '/news/recruit' },
  ]},
  { label: 'Healthcare', href: '/international', children: [
    { label: 'International Healthcare', href: '/international' },
    { label: '해외 파트너', href: '/international/partners' },
    { label: '보험·비용 안내', href: '/international/insurance' },
    { label: '의료 연동 (FHIR)', href: '/international/interoperability' },
  ]},
  { label: '고객참여', href: '/support', children: [
    { label: 'FAQ', href: '/support/faq' },
    { label: '고객의 소리', href: '/support/voc' },
  ]},
];

export function GNB() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // 특성화 센터 하위메뉴를 실제 운영 센터로 동적 동기화(slug 드리프트→링크깨짐 방지). 실패 시 MENU fallback.
  const [centers, setCenters] = useState<{ label: string; href: string }[] | null>(null);
  useEffect(() => {
    fetch('/api/v1/public/centers')
      .then(r => r.json())
      .then((res: { data?: { title?: string; slug?: string }[] }) => {
        const items = (res?.data ?? [])
          .filter(c => c?.slug && c?.title)
          .map(c => ({ label: c.title as string, href: `/care/centers/${c.slug}` }));
        if (items.length) setCenters(items);
      })
      .catch(() => {});
  }, []);
  const menu = centers ? MENU.map(m => (m.href === '/care/centers' ? { ...m, children: centers } : m)) : MENU;

  const handleKeyDown = useCallback((e: React.KeyboardEvent, label: string) => {
    if (e.key === 'Escape') {
      setOpenMenu(null);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpenMenu(openMenu === label ? null : label);
    }
  }, [openMenu]);

  return (
    <header className="bg-white/90 backdrop-blur-lg border-b border-gray-100/80 sticky top-0 z-50" role="banner">
      <div className="max-w-7xl mx-auto px-4 lg:px-8">
        <div className="flex items-center justify-between h-[68px]">
          {/* 로고 */}
          <Link href="/" className="flex items-center gap-3 group shrink-0" aria-label="위루비병원 홈">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital 로고" className="h-10 w-auto max-w-none" />
          </Link>

          {/* 데스크톱 메뉴 */}
          <nav className="hidden lg:flex items-center gap-0.5" aria-label="주 메뉴">
            {menu.map(item => {
              const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
              const isOpen = openMenu === item.label;
              const hasChildren = item.children.length > 0;

              return (
                <div
                  key={item.label}
                  className="relative"
                  onMouseEnter={() => setOpenMenu(item.label)}
                  onMouseLeave={() => setOpenMenu(null)}
                >
                  <Link
                    href={item.href}
                    className={`whitespace-nowrap px-2.5 py-2 text-[13px] font-semibold rounded-lg transition ${
                      isActive ? 'text-blue-700 bg-blue-50' : 'text-gray-600 hover:text-blue-700 hover:bg-blue-50/60'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                    aria-expanded={hasChildren ? isOpen : undefined}
                    aria-haspopup={hasChildren ? 'true' : undefined}
                    onKeyDown={e => hasChildren && handleKeyDown(e, item.label)}
                    onFocus={() => hasChildren && setOpenMenu(item.label)}
                  >
                    {item.label}
                  </Link>

                  {hasChildren && isOpen && (
                    <div className="absolute top-full left-0 pt-2 min-w-[212px]" role="menu" aria-label={`${item.label} 하위 메뉴`}>
                      <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 ring-1 ring-gray-100/80 p-1.5">
                        {item.children.map(child => (
                          <Link
                            key={child.href}
                            href={child.href}
                            role="menuitem"
                            className="group/mi flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors focus:outline-none focus:bg-blue-50 focus:text-blue-700"
                            onBlur={(e) => {
                              const parent = e.currentTarget.closest('[role="menu"]');
                              if (parent && !parent.contains(e.relatedTarget as Node)) {
                                setOpenMenu(null);
                              }
                            }}
                          >
                            <span className="w-1 h-1 rounded-full bg-gray-300 group-hover/mi:bg-blue-500 transition-colors" aria-hidden />
                            <span className="whitespace-nowrap">{child.label}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* 우측 버튼 */}
          <div className="flex items-center gap-2">
            <select defaultValue="ko" onChange={e => { const t = LANG_LANDING.find(l => l.v === e.target.value); if (t) router.push(t.href); }} aria-label="Language"
              className="text-[12px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer">
              {LANG_LANDING.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
            </select>
            <Link
              href="/search"
              className="hidden sm:flex p-2.5 text-gray-400 hover:text-blue-600 rounded-xl hover:bg-gray-50 transition"
              aria-label="통합 검색"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </Link>
            <Link
              href="/booking"
              className="hidden sm:flex items-center gap-2 whitespace-nowrap px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[13px] font-semibold rounded-xl hover:shadow-lg hover:shadow-blue-200/50 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              예약하기
            </Link>
            <Link href={PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hidden xl:flex whitespace-nowrap px-2 py-2 text-[13px] text-gray-500 hover:text-blue-600 font-medium transition">
              환자포털
            </Link>

            {/* 모바일 햄버거 */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition"
              aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
              aria-expanded={mobileOpen}
            >
              <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                {mobileOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                }
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 모바일 메뉴 */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-gray-100 bg-white" role="dialog" aria-label="모바일 메뉴">
          <nav className="max-w-7xl mx-auto px-4 py-3 space-y-1" aria-label="모바일 내비게이션">
            {menu.map(item => (
              <div key={item.label}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 text-sm font-semibold text-gray-800 rounded-lg hover:bg-blue-50 hover:text-blue-700"
                >
                  {item.label}
                </Link>
                {item.children.length > 0 && (
                  <div className="pl-6 space-y-0.5">
                    {item.children.map(child => (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setMobileOpen(false)}
                        className="block px-3 py-1.5 text-xs text-gray-500 rounded hover:text-blue-600 hover:bg-gray-50"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="pt-2 border-t border-gray-100 flex gap-2">
              <Link href="/booking" onClick={() => setMobileOpen(false)}
                className="flex-1 text-center px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-semibold rounded-xl">
                예약하기
              </Link>
              <Link href={PORTAL_URL} target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}
                className="flex-1 text-center px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl">
                환자포털
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
