'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface DoctorItem {
  id: string; userId: string; position: string | null;
  certifications: string[]; scheduleNote: string | null;
  user: { familyName: string; givenName: string; department: string; specialty: string | null };
}

export default function DoctorsManagePage() {
  const tAttr = useTAttr();
  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiClient.get<{ data: DoctorItem[] }>('/api/v1/public/doctors')
      .then(res => setDoctors(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? doctors.filter(d => {
        const name = `${d.user.familyName}${d.user.givenName}`;
        return name.includes(search) || d.user.department.includes(search) || (d.user.specialty ?? '').includes(search);
      })
    : doctors;

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="의료진 프로필 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="홈페이지에 표시되는 의료진 정보를 확인합니다 — 상세 편집은 직원 관리에서" /></p>
        </div>
        <Link href="/admin/staff-management"
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
          <T k="직원 관리에서 편집 →" />
        </Link>
      </div>

      <div className="relative max-w-md">
        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={tAttr('이름, 진료과, 전공으로 검색...')}
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          {search ? <>{`"${search}" `}<T k="검색 결과 없음" /></> : <T k="등록된 의료진이 없습니다" />}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(doc => {
            const name = `${doc.user.familyName}${doc.user.givenName}`;
            return (
              <div key={doc.id} className="bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-md transition">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-lg font-bold text-blue-700">
                    {doc.user.familyName}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{name}</p>
                    {/* 🔴 W9: `position ?? '전문의'` — 직위가 비어 있으면 화면이 '전문의'라고 **지어냈다**.
                        직위는 자격 표시다. 모르는 것은 모른다고 말한다. */}
                    <p className={`text-xs ${doc.position ? 'text-gray-500' : 'text-gray-300'}`}>{doc.position || tAttr('직위 미등록')}</p>
                    <p className="text-[11px] text-blue-600 font-medium">{doc.user.department}</p>
                  </div>
                </div>
                {doc.user.specialty && (
                  <p className="text-[11px] text-gray-400 mt-2"><T k="전공" />: {doc.user.specialty}</p>
                )}
                {doc.certifications.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {doc.certifications.slice(0, 3).map(c => (
                      <span key={c} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
