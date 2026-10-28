'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { HOSPITAL_CONTACT } from '@/lib/hospital-contact';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

interface CmsItem {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[];
  imageUrl: string | null; updatedAt: string;
}

const SLUG_IMAGES: Record<string, string> = {
  'checkup-program-a': '/images/homepage/checkup/checkup-basic.png',
  'checkup-program-b': '/images/homepage/checkup/checkup-premium.png',
  'checkup-national': '/images/homepage/checkup/checkup-national.png',
  'checkup-corporate': '/images/homepage/checkup/checkup-corporate.png',
  'checkup-process': '/images/homepage/checkup/checkup-process.png',
  'checkup-preparation': '/images/homepage/checkup/checkup-result.png',
};

const SLUG_COLOR: Record<string, { bg: string; accent: string; badge: string }> = {
  'checkup-program-a': { bg: 'from-blue-500 to-sky-600', accent: 'text-blue-600', badge: '기본' },
  'checkup-program-b': { bg: 'from-purple-500 to-indigo-600', accent: 'text-purple-600', badge: '정밀' },
  'checkup-national': { bg: 'from-green-500 to-emerald-600', accent: 'text-green-600', badge: '국가검진' },
  'checkup-corporate': { bg: 'from-slate-500 to-gray-600', accent: 'text-slate-600', badge: '단체검진' },
  'checkup-process': { bg: 'from-teal-500 to-cyan-600', accent: 'text-teal-600', badge: '절차' },
  'checkup-preparation': { bg: 'from-amber-500 to-orange-600', accent: 'text-amber-600', badge: '준비사항' },
};

// CMS 텍스트에서 검사 항목 추출
function parseCheckupItems(content: string): { intro: string; items: string[]; footer: string[] } {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const intro: string[] = [];
  const items: string[] = [];
  const footer: string[] = [];
  let inItems = false;

  for (const line of lines) {
    if (line.startsWith('- ') || line.startsWith('• ')) {
      inItems = true;
      items.push(line.replace(/^[-•]\s*/, ''));
    } else if (line.startsWith('검사 항목') || line.startsWith('검진 항목') || line.startsWith('포함 항목')) {
      inItems = true;
    } else if (line.startsWith('소요시간') || line.startsWith('결과') || line.startsWith('※') || line.startsWith('📞')) {
      footer.push(line);
    } else if (!inItems) {
      intro.push(line);
    } else {
      footer.push(line);
    }
  }
  return { intro: intro.join('\n'), items, footer };
}

// 검사 항목별 아이콘
const ITEM_ICONS: Record<string, string> = {
  '신체계측': 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952',
  '혈액검사': 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5',
  '소변': 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5',
  'X-ray': 'M6.827 6.175A2.31 2.31 0 015.186 7.23',
  '심전도': 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5',
  '초음파': 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3',
  '내시경': 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z',
  '안과': 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z',
  'CT': 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12',
  'MRI': 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12',
  '청력': 'M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424',
  '폐기능': 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
};

function getItemIcon(item: string): string {
  for (const [key, path] of Object.entries(ITEM_ICONS)) {
    if (item.includes(key)) return path;
  }
  return 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z'; // check circle
}

export default function CheckupDetailPage() {
  const { slug } = useParams();
  const [item, setItem] = useState<CmsItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/hospital-info?category=CHECKUP_INFO')
      .then(r => r.json())
      .then(res => setItem((res.data ?? []).find((i: CmsItem) => i.slug === slug) ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!item) return <div className="text-center py-20 text-gray-400">검진 프로그램을 찾을 수 없습니다<br/><Link href="/checkup" className="text-blue-600 text-sm mt-2 inline-block hover:underline">목록으로 돌아가기</Link></div>;

  const imgSrc = SLUG_IMAGES[item.slug];
  const color = SLUG_COLOR[item.slug] ?? { bg: 'from-blue-500 to-sky-600', accent: 'text-blue-600', badge: '검진' };
  const { intro, items: checkupItems, footer } = parseCheckupItems(item.content);

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      {/* 뒤로가기 */}
      <Link href="/checkup" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        건강검진
      </Link>

      {/* 히어로 */}
      <div className={`relative bg-gradient-to-r ${color.bg} rounded-2xl overflow-hidden`}>
        <div className="flex flex-col md:flex-row">
          <div className="p-6 lg:p-8 flex-1 text-white">
            <span className="inline-block bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full mb-3">{color.badge}</span>
            <h1 className="text-2xl lg:text-3xl font-bold mb-3">{item.title}</h1>
            <p className="text-white/80 text-sm leading-relaxed">{intro || item.content.slice(0, 150)}</p>
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {item.tags.map(t => <span key={t} className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full">{t}</span>)}
              </div>
            )}
          </div>
          {imgSrc && (
            <div className="md:w-64 h-48 md:h-auto overflow-hidden flex-shrink-0">
              <img src={imgSrc} alt={item.title} className="w-full h-full object-cover opacity-80" />
            </div>
          )}
        </div>
      </div>

      {/* 검사 항목 그리드 */}
      {checkupItems.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-blue-500 rounded-full" />
            검사 항목
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {checkupItems.map((ci, i) => (
              <div key={i} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:shadow-sm transition">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color.bg} bg-opacity-10 flex items-center justify-center flex-shrink-0`}>
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={getItemIcon(ci)} />
                  </svg>
                </div>
                <span className="text-sm text-gray-700">{ci}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 전체 본문 (구조화 렌더링) */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <span className="w-1.5 h-6 bg-emerald-500 rounded-full" />
          상세 안내
        </h2>
        <ContentRenderer content={item.content} className="text-sm text-gray-700" />
      </div>

      {/* 푸터 정보 */}
      {footer.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          {footer.map((f, i) => <p key={i} className="text-sm text-amber-800">{f}</p>)}
        </div>
      )}

      {/* 예약 CTA */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-lg font-bold">검진 예약</h3>
          {/* 🔴 (2026-09-15 E1) 검진센터 내선·운영시간 코드 상수 → CMS 안내 페이지·대표전화 정본(시각을 지어내지 않는다) */}
          <p className="text-blue-100 text-sm mt-1">대표전화 ☎ {HOSPITAL_CONTACT.main} · <Link href="/checkup/faq" className="underline">운영시간·전화 예약 안내</Link></p>
        </div>
        <div className="flex gap-3">
          <Link href="/portal?tab=health" className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold text-sm px-6 py-3 rounded-xl hover:bg-blue-50 transition shadow-lg">
            온라인 예약
          </Link>
          <Link href={`/booking?intent=${encodeURIComponent('건강검진을 받고 싶어요')}`} className="inline-flex items-center gap-2 bg-white/20 text-white font-medium text-sm px-5 py-3 rounded-xl hover:bg-white/30 transition">
            {AI_ORIGIN_TEXT} 상담
          </Link>
        </div>
      </div>
    </div>
  );
}
