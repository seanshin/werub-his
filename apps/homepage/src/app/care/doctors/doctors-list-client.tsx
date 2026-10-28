'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { DoctorAvatar } from '@/components/homepage/DoctorAvatar';

interface DoctorProfile {
  id: string; userId: string; position: string | null;
  education: string[]; career: string[]; certifications: string[];
  introduction: string | null; photoUrl: string | null; scheduleNote: string | null;
  user: { id: string; familyName: string; givenName: string; department: string; specialty: string | null };
}

export function DoctorsListClient({ doctors }: { doctors: DoctorProfile[] }) {
  const [selectedDept, setSelectedDept] = useState('');
  const [search, setSearch] = useState('');

  const departments = useMemo(() => {
    const depts = new Set(doctors.map(d => d.user.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [doctors]);

  const filtered = doctors.filter(d => {
    if (selectedDept && d.user.department !== selectedDept) return false;
    if (!search) return true;
    const name = `${d.user.familyName}${d.user.givenName}`;
    const spec = d.user.specialty ?? '';
    return name.includes(search) || spec.includes(search) || d.user.department.includes(search);
  });

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      <div>
        <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Medical Staff</p>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900">의료진 소개</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원의 전문 의료진을 소개합니다</p>
      </div>

      {/* 필터 + 검색 */}
      <div className="flex flex-col sm:flex-row gap-3 bg-gray-50 rounded-2xl p-4">
        <select
          value={selectedDept}
          onChange={e => setSelectedDept(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          aria-label="진료과 선택"
        >
          <option value="">전체 진료과 ({doctors.length}명)</option>
          {departments.map(dept => (
            <option key={dept} value={dept}>{dept}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="의사명 / 전공 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="의료진 검색"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {(selectedDept || search) && (
          <button
            onClick={() => { setSelectedDept(''); setSearch(''); }}
            className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl bg-white transition"
          >
            초기화
          </button>
        )}
      </div>

      {/* 결과 수 */}
      <p className="text-xs text-gray-400">
        {selectedDept && <span className="text-blue-600 font-medium">{selectedDept}</span>}
        {selectedDept && ' · '}
        총 <span className="font-semibold text-gray-600">{filtered.length}</span>명
      </p>

      {/* 카드 */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p>검색 결과가 없습니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="list">
          {filtered.map((doc) => {
            const fullName = `${doc.user.familyName}${doc.user.givenName}`;
            return (
              <Link key={doc.id} href={`/care/doctors/${doc.userId}`}
                className="group bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-lg hover:border-blue-200 hover:-translate-y-0.5 transition-all duration-300" role="listitem">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0">
                    {doc.photoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={doc.photoUrl} alt={fullName} className="w-full h-full object-cover" />
                      : <DoctorAvatar name={fullName} size={56} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[15px] font-bold text-gray-900 group-hover:text-blue-700 transition">{fullName}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{doc.position ?? '전문의'}</p>
                    <p className="text-xs text-blue-600 font-semibold mt-0.5">{doc.user.department}</p>
                    {doc.user.specialty && <p className="text-[11px] text-gray-400 mt-0.5">{doc.user.specialty}</p>}
                  </div>
                </div>
                {doc.certifications.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-50 flex flex-wrap gap-1">
                    {doc.certifications.slice(0, 2).map(c => (
                      <span key={c} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">{c}</span>
                    ))}
                    {doc.certifications.length > 2 && (
                      <span className="text-[10px] text-gray-400">+{doc.certifications.length - 2}</span>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
