'use client';
import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';

interface CenterDetail {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[];
}

const CENTER_IMAGES: Record<string, string> = {
  'cardiovascular-center': '/images/homepage/centers/center-cardiovascular.png',
  'center-cardiovascular': '/images/homepage/centers/center-cardiovascular.png',
  'cancer-center': '/images/homepage/centers/center-cancer.png',
  'center-cancer': '/images/homepage/centers/center-cancer.png',
  'joint-spine-center': '/images/homepage/centers/center-joint-spine.png',
  'center-joint-spine': '/images/homepage/centers/center-joint-spine.png',
  'checkup-center': '/images/homepage/centers/center-checkup.png',
  'center-checkup': '/images/homepage/centers/center-checkup.png',
  'dialysis-center': '/images/homepage/centers/center-dialysis.png',
  'center-dialysis': '/images/homepage/centers/center-dialysis.png',
  'transplant-center': '/images/homepage/centers/center-transplant.png',
  'trauma-center': '/images/homepage/centers/center-trauma.png',
  'robotic-surgery-center': '/images/homepage/centers/center-robotic.png',
};

// 진료과명 → slug 매핑
const DEPT_SLUG_MAP: Record<string, string> = {
  '순환기내과': 'internal-medicine', '호흡기내과': 'internal-medicine', '내과': 'internal-medicine',
  '외과': 'surgery', '흉부외과': 'surgery', '일반외과': 'surgery',
  '정형외과': 'orthopedics', '신경외과': 'neurosurgery',
  '소아청소년과': 'pediatrics', '산부인과': 'obgyn',
  '안과': 'ophthalmology', '이비인후과': 'ent', '피부과': 'dermatology',
  '비뇨의학과': 'urology', '정신건강의학과': 'psychiatry',
  '재활의학과': 'rehabilitation', '가정의학과': 'family-medicine',
  '마취통증의학과': 'anesthesiology', '영상의학과': 'radiology',
  '병리과': 'pathology', '진단검사의학과': 'laboratory',
  '혈액종양내과': 'internal-medicine', '방사선종양학과': 'radiation',
  '응급의학과': 'emergency-medicine', '치과': 'dental',
  '신장내과': 'internal-medicine', '소화기내과': 'internal-medicine',
  '내분비내과': 'internal-medicine',
};

export default function CenterDetailPage() {
  const { slug } = useParams();
  const [center, setCenter] = useState<CenterDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/centers')
      .then(r => r.json())
      .then(res => setCenter((res.data ?? []).find((c: CenterDetail) => c.slug === slug) ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!center) return <div className="text-center py-20 text-gray-400">센터 정보를 찾을 수 없습니다</div>;

  const meta = center.metadata;
  const departments = (meta?.departments as string[]) ?? [];
  const features = (meta?.features as string[]) ?? [];
  const location = meta?.location as string | undefined;
  const phone = meta?.phone as string | undefined;
  const imgSrc = CENTER_IMAGES[center.slug];

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      {/* 뒤로가기 */}
      <Link href="/care/centers" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        전문센터 목록
      </Link>

      {/* 배너 이미지 */}
      {imgSrc && (
        <div className="h-52 lg:h-64 rounded-2xl overflow-hidden relative">
          <img src={imgSrc} alt={center.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <h1 className="absolute bottom-5 left-6 text-2xl lg:text-3xl font-bold text-white drop-shadow-lg">{center.title}</h1>
        </div>
      )}
      {!imgSrc && <h1 className="text-2xl font-bold text-gray-900">{center.title}</h1>}

      {/* 위치/연락처 */}
      {(location || phone) && (
        <div className="flex flex-wrap gap-4 text-sm text-gray-500">
          {location && (
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
              {location}
            </span>
          )}
          {phone && (
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
              {phone}
            </span>
          )}
        </div>
      )}

      {/* 본문 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <ContentRenderer content={center.content} className="text-sm text-gray-700" />
      </div>

      {/* 참여 진료과 — 클릭 가능 링크 */}
      {departments.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>
            참여 진료과
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {departments.map(d => {
              const deptSlug = DEPT_SLUG_MAP[d];
              return deptSlug ? (
                <Link key={d} href={`/care/departments/${deptSlug}`}
                  className="flex items-center gap-2 px-4 py-3 bg-blue-50 hover:bg-blue-100 border border-blue-100 hover:border-blue-200 rounded-xl transition text-sm font-medium text-blue-700">
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  {d}
                </Link>
              ) : (
                <span key={d} className="flex items-center gap-2 px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-medium text-gray-600">{d}</span>
              );
            })}
          </div>
        </div>
      )}

      {/* 주요 특장점 */}
      {features.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" /></svg>
            주요 특장점
          </h2>
          <ul className="space-y-2">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold">{i + 1}</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 예약 CTA */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-lg font-bold">진료 상담 및 예약</h3>
          <p className="text-blue-100 text-sm mt-1">{center.title}에서 최상의 진료를 받으세요</p>
        </div>
        <Link href="/booking" className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold text-sm px-6 py-3 rounded-xl hover:bg-blue-50 transition shadow-lg">
          온라인 예약
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
        </Link>
      </div>
    </div>
  );
}
