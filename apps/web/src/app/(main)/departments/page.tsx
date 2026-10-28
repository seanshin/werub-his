'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface DeptContent {
  id: string;
  category: string;
  slug: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  sortOrder: number;
  imageUrl: string | null;
  tags: string[];
  isPinned: boolean;
  updatedAt: string;
}

const DEPT_ICONS: Record<string, string> = {
  'internal-medicine': '🫀', cardiology: '🫀', pulmonology: '🫁', gastroenterology: '🔬',
  endocrinology: '💉', nephrology: '🫘', 'hematology-oncology': '🩸', infectious: '🦠',
  rheumatology: '🦴', surgery: '🔪', 'thoracic-surgery': '🫁', orthopedics: '🦴',
  neurosurgery: '🧠', 'plastic-surgery': '✨', urology: '🏥', obgyn: '👶',
  pediatrics: '🧒', psychiatry: '🧠', dermatology: '🧴', ophthalmology: '👁️',
  ent: '👂', rehabilitation: '💪', 'radiation-oncology': '☢️', 'family-medicine': '👨‍👩‍👧',
  anesthesiology: '😴', 'emergency-medicine': '🚑', dental: '🦷', radiology: '📷',
  pathology: '🔬', 'laboratory-medicine': '🧪',
};

const DEPT_COLORS: Record<string, string> = {
  'internal-medicine': 'bg-red-50 border-red-200 text-red-700',
  cardiology: 'bg-red-50 border-red-200 text-red-700',
  pulmonology: 'bg-sky-50 border-sky-200 text-sky-700',
  gastroenterology: 'bg-amber-50 border-amber-200 text-amber-700',
  surgery: 'bg-orange-50 border-orange-200 text-orange-700',
  orthopedics: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  neurosurgery: 'bg-purple-50 border-purple-200 text-purple-700',
  obgyn: 'bg-pink-50 border-pink-200 text-pink-700',
  pediatrics: 'bg-cyan-50 border-cyan-200 text-cyan-700',
  psychiatry: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  dermatology: 'bg-rose-50 border-rose-200 text-rose-700',
  ophthalmology: 'bg-teal-50 border-teal-200 text-teal-700',
  ent: 'bg-lime-50 border-lime-200 text-lime-700',
  rehabilitation: 'bg-green-50 border-green-200 text-green-700',
  'emergency-medicine': 'bg-red-50 border-red-300 text-red-800',
  dental: 'bg-blue-50 border-blue-200 text-blue-700',
};

function getIcon(slug: string) {
  return DEPT_ICONS[slug] ?? '🏥';
}

function getColor(slug: string) {
  return DEPT_COLORS[slug] ?? 'bg-gray-50 border-gray-200 text-gray-700';
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<DeptContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiClient.get<{ data: DeptContent[] }>('/api/v1/public/departments')
      .then(res => setDepartments(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = departments.filter(d =>
    !search || d.title.includes(search) || d.content.includes(search) || d.tags.some(t => t.includes(search))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">진료과 안내</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원 각 진료과의 전문 분야와 의료진을 소개합니다</p>
      </div>

      {/* 검색 */}
      <div className="relative max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="진료과 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* 진료과 카드 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg">검색 결과가 없습니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(dept => {
            const meta = dept.metadata as Record<string, unknown>;
            const specialties = (meta?.specialties as string[]) ?? [];
            const location = (meta?.location as string) ?? '';
            const phone = (meta?.phone as string) ?? '';

            return (
              <Link
                key={dept.id}
                href={`/departments/${dept.slug}`}
                className={`block border rounded-2xl p-5 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 ${getColor(dept.slug)}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">{getIcon(dept.slug)}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold">{dept.title}</h3>
                    {location && (
                      <p className="text-[11px] opacity-70 mt-0.5">{location}</p>
                    )}
                  </div>
                  {dept.isPinned && (
                    <span className="text-[10px] bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap">NEW</span>
                  )}
                </div>

                <p className="text-xs mt-3 line-clamp-2 opacity-80">{dept.content.slice(0, 100)}</p>

                {specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {specialties.slice(0, 4).map(s => (
                      <span key={s} className="text-[10px] bg-white/60 border border-current/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">{s}</span>
                    ))}
                    {specialties.length > 4 && (
                      <span className="text-[10px] opacity-50">+{specialties.length - 4}</span>
                    )}
                  </div>
                )}

                {phone && (
                  <p className="text-[11px] mt-3 opacity-60">
                    {phone}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* 진료 시간 안내 */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-blue-800 mb-3">진료 시간 안내</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><span className="font-medium text-blue-700">평일</span><br/><span className="text-blue-600">09:00 ~ 18:00</span></div>
          <div><span className="font-medium text-blue-700">토요일</span><br/><span className="text-blue-600">09:00 ~ 13:00</span></div>
          <div><span className="font-medium text-blue-700">점심시간</span><br/><span className="text-blue-600">12:30 ~ 14:00</span></div>
          <div><span className="font-medium text-red-600">일/공휴일 휴진</span><br/><span className="text-red-500">응급실 24시간</span></div>
        </div>
      </div>
    </div>
  );
}
