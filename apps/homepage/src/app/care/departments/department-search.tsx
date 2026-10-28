'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DeptIllustration } from '@/components/homepage/DeptIllustration';

interface DeptContent {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[]; isPinned: boolean;
}

interface Props {
  departments: DeptContent[];
}

export function DepartmentSearch({ departments }: Props) {
  const [search, setSearch] = useState('');

  const filtered = departments.filter(d =>
    !search || d.title.includes(search) || d.content.includes(search) || d.tags.some(t => t.includes(search))
  );

  return (
    <>
      {/* 검색 */}
      <div className="relative max-w-md">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="진료과명, 질환, 키워드 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="진료과 검색"
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm"
        />
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-gray-400">{filtered.length}개 진료과</p>
      )}

      {/* 진료과 카드 */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p>검색 결과가 없습니다</p></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(dept => {
            const meta = dept.metadata as Record<string, unknown>;
            const specialties = (meta?.specialties as string[]) ?? [];
            const location = (meta?.location as string) ?? '';
            const phone = (meta?.phone as string) ?? '';
            const diseases = (meta?.diseases as string[]) ?? [];
            const plainContent = dept.content.replace(/<[^>]*>/g, '');

            return (
              <Link
                key={dept.id}
                href={`/care/departments/${dept.slug}`}
                className="group bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                {/* 상단 일러스트 배너 */}
                <div className="relative h-28 flex items-center justify-center overflow-hidden">
                  <DeptIllustration slug={dept.slug} size={280} className="w-full h-full !rounded-none" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                  <div className="absolute bottom-3 left-4">
                    <h3 className="text-lg font-extrabold text-white drop-shadow-sm">{dept.title}</h3>
                    {location && <p className="text-[11px] text-white/80">{location}</p>}
                  </div>
                </div>

                {/* 하단 콘텐츠 */}
                <div className="p-4">
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 min-h-[2.5rem]">
                    {plainContent.slice(0, 100)}
                  </p>

                  {/* 전문분야 태그 */}
                  {specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {specialties.slice(0, 3).map(s => (
                        <span key={s} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">{s}</span>
                      ))}
                      {specialties.length > 3 && (
                        <span className="text-[10px] text-gray-400">+{specialties.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* 주요 질환 미리보기 */}
                  {diseases.length > 0 && (
                    <p className="text-[10px] text-gray-400 mt-2 line-clamp-1">
                      주요 질환: {diseases.slice(0, 4).join(', ')}{diseases.length > 4 ? ' 등' : ''}
                    </p>
                  )}

                  {/* 전화번호 */}
                  {phone && (
                    <p className="text-[11px] text-gray-400 mt-3 pt-3 border-t border-gray-50 flex items-center gap-1">
                      📞 {phone}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
