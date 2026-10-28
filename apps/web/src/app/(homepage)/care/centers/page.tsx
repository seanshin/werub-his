import Link from 'next/link';
import { publicFetchResult } from '@/lib/public-fetch';
import { PublicLoadFailed } from '@/components/homepage/PublicLoadFailed';

export const revalidate = 3600;

interface CenterItem {
  id: string; slug: string; title: string; content: string; imageUrl: string | null;
  metadata: { departments?: string[]; location?: string; phone?: string; features?: string[] };
  tags: string[]; updatedAt: string;
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

const CENTER_BADGES: Record<string, { text: string; color: string }> = {
  'cardiovascular-center': { text: '24시간 응급', color: 'bg-red-500' },
  'center-cardiovascular': { text: '24시간 응급', color: 'bg-red-500' },
  'cancer-center': { text: '다학제 진료', color: 'bg-purple-500' },
  'center-cancer': { text: '다학제 진료', color: 'bg-purple-500' },
  'joint-spine-center': { text: '원스톱 치료', color: 'bg-emerald-500' },
  'center-joint-spine': { text: '원스톱 치료', color: 'bg-emerald-500' },
  'checkup-center': { text: '원스톱 검진', color: 'bg-blue-500' },
  'center-checkup': { text: '원스톱 검진', color: 'bg-blue-500' },
  'dialysis-center': { text: '주야간 투석', color: 'bg-teal-500' },
  'center-dialysis': { text: '주야간 투석', color: 'bg-teal-500' },
};

export default async function CentersPage() {
  // 🔴 조회 실패가 빈 카드 그리드(말 없이 0개)가 되지 않게 — 실패는 실패로 말한다
  const r = await publicFetchResult<CenterItem[]>('/api/v1/public/centers', 3600);
  if (!r.ok) return <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10"><PublicLoadFailed what="전문센터 목록" /></div>;
  const raw = r.data ?? [];
  // 중복 제거: 같은 title이면 content가 긴 것(상세)만 유지
  const titleMap = new Map<string, CenterItem>();
  for (const c of raw) {
    const existing = titleMap.get(c.title);
    if (!existing || c.content.length > existing.content.length) titleMap.set(c.title, c);
  }
  const centers = Array.from(titleMap.values());

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
      {/* 헤더 */}
      <div className="mb-10">
        <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Specialized Centers</p>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900">전문센터</h1>
        <p className="text-sm text-gray-500 mt-2">여러 진료과가 협력하여 통합 진료를 제공하는 전문센터입니다</p>
      </div>

      {/* 센터 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {centers.map(c => {
          const plainContent = c.content.replace(/<[^>]*>/g, '').trim();
          const imgSrc = CENTER_IMAGES[c.slug] || c.imageUrl;
          const badge = CENTER_BADGES[c.slug];
          return (
            <Link key={c.id} href={`/care/centers/${c.slug}`}
              className="group bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-xl hover:border-blue-200 hover:-translate-y-1 transition-all duration-300 flex flex-col">
              {/* 이미지 */}
              <div className="h-44 overflow-hidden relative bg-gradient-to-br from-blue-100 to-indigo-100">
                {imgSrc && <img src={imgSrc} alt={c.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                {badge && (
                  <span className={`absolute top-3 right-3 text-[10px] text-white font-bold px-2.5 py-1 rounded-full ${badge.color} shadow-sm`}>
                    {badge.text}
                  </span>
                )}
                <h3 className="absolute bottom-3 left-4 text-lg font-bold text-white drop-shadow-md">{c.title}</h3>
              </div>

              {/* 본문 */}
              <div className="p-5 flex-1 flex flex-col">
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 flex-1">{plainContent.slice(0, 100)}</p>

                {/* 진료과 태그 */}
                {c.metadata?.departments && c.metadata.departments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {c.metadata.departments.map(d => (
                      <span key={d} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">{d}</span>
                    ))}
                  </div>
                )}

                {/* 위치 */}
                {c.metadata?.location && (
                  <p className="text-[11px] text-gray-400 mt-3 pt-3 border-t border-gray-50 flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                    {c.metadata.location}{c.metadata.phone && ` · ${c.metadata.phone}`}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
