import { publicFetchResult } from '@/lib/public-fetch';
import { PublicLoadFailed } from '@/components/homepage/PublicLoadFailed';
import { getClinicHours } from '@/lib/clinic-hours';
import { ClinicHoursNotice } from '@/components/homepage/ClinicHoursNotice';
import { SITE_INFO } from '@/lib/site-info';
import { DepartmentSearch } from './department-search';

export const revalidate = 3600;

interface DeptContent {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; sortOrder: number;
  imageUrl: string | null; tags: string[]; isPinned: boolean;
}

export default async function DepartmentsPage() {
  const [departments, hours] = await Promise.all([
    // 🔴 조회 실패를 "검색 결과가 없습니다"로 그리지 않는다 — 진료 시간 안내는 조회와 무관하게 그대로 둔다
    publicFetchResult<DeptContent[]>('/api/v1/public/departments', 3600).then(r => (r.ok ? r.data ?? [] : null)),
    getClinicHours(),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-8">
      <div>
        <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Departments</p>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900">진료과 안내</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원 각 진료과의 전문 분야와 의료진을 소개합니다</p>
      </div>

      {departments === null ? <PublicLoadFailed what="진료과 목록" /> : <DepartmentSearch departments={departments} />}

      {/* 진료 시간 안내 */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-blue-800 mb-4">진료 시간 안내</h3>
        {/* 🔴 W9: 09:00~18:00 · 점심 12:30~14:00 이 박혀 있어 /care/schedule(CMS 정본)과 달랐다
            🔴 T6: CMS 를 못 읽으면 코드 상수를 그리지 않는다 · 본문에 없는 칸은 '안내 없음' */}
        {hours.source === 'cms' ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="bg-white rounded-xl p-3"><span className="font-semibold text-blue-700">평일</span><p className="text-blue-600 mt-0.5">{hours.weekday}</p></div>
            <div className="bg-white rounded-xl p-3"><span className="font-semibold text-blue-700">토요일</span><p className="text-blue-600 mt-0.5">{hours.saturday ?? '안내 없음'}</p></div>
            <div className="bg-white rounded-xl p-3"><span className="font-semibold text-blue-700">점심시간</span><p className="text-blue-600 mt-0.5">{hours.lunch ?? '안내 없음'}</p></div>
            <div className="bg-white rounded-xl p-3"><span className="font-semibold text-red-600">{hours.closed ?? '휴진일 안내 없음'}</span><p className="text-red-500 mt-0.5">응급실 24시간</p></div>
          </div>
        ) : (
          <ClinicHoursNotice hours={hours} phone={SITE_INFO.phone} className="text-sm text-blue-800" />
        )}
      </div>
    </div>
  );
}
