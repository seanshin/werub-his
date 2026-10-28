'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import Link from 'next/link';
import StatCard from '@/components/ui/StatCard';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 의료 품질 대시보드 — 🔴 W7 규약: 조회 실패(`unavailable`)를 "0건"(=안전함)으로 접지 않는다.
 * 진료과 축·균주 분포는 **서버가 실데이터에서** 만든 것을 그대로 그린다(하드코딩 목록 금지).
 */

interface ClinicalOverview {
  todayEncounters: number;
  totalAppointments: number;
  waitingPatients: number;
  waitingBasis?: string;
  inpatients: number;
  icuPatients: number;
}

interface DoctorPerf {
  id: string;
  name: string;
  department: string;
  role?: string;
  isDoctor?: boolean;
  isActive?: boolean;
  todayEncounters: number;
  weekEncounters: number;
  waitingPatients: number;
  incompleteCharts: number;
}

interface SafetyData {
  unavailable?: boolean;
  since?: string;
  totalIncidents: number | null;
  falls: number | null;
  medicationErrors: number | null;
  others: number | null;
  byType?: Array<{ type: string; count: number }>;
}

interface InfectionData {
  unavailable?: boolean;
  active: number | null;
  mrsa: number | null;
  mrsaBasis?: string;
  sAureusUnclassified?: number | null;
  organismUnknown?: number | null;
  others: number | null;
  isolated: number | null;
  organisms?: Array<{ name: string; count: number }>;
}

interface WeeklyData {
  departments: string[];
  days: Array<{ date: string; [dept: string]: string | number }>;
  total?: number;
  basis?: string;
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** `YYYY-MM-DD`(서버 localDateKey=KST 달력) → 로컬 Date. `new Date('YYYY-MM-DD')` 는 UTC 자정이라 밀린다. */
function parseDayKey(key: string): Date {
  const [y, m, d] = String(key).split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? new Date(y, m - 1, d) : new Date(key);
}

/** 숫자를 모르면 '-' 라고 말한다(0 이라고 말하지 않는다) */
function n2s(v: number | null | undefined, suffix = ''): string {
  return v == null ? '-' : `${v}${suffix}`;
}

export default function ClinicalDashboardPage() {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const today = new Date();
  const greeting = today.getHours() < 12 ? '좋은 아침입니다' : today.getHours() < 18 ? '좋은 오후입니다' : '좋은 저녁입니다';

  const { data: overview, isError, error, refetch } = useQuery({
    queryKey: ['exec-clinical-overview'],
    queryFn: () => apiClient.get<{ data: ClinicalOverview }>('/api/v1/executive/clinical/overview'),
    refetchInterval: pollMs('slow'),
  });
  const { data: doctorsData } = useQuery({
    queryKey: ['exec-doctors'],
    queryFn: () => apiClient.get<{ data: DoctorPerf[] }>('/api/v1/executive/clinical/doctors'),
  });
  const { data: safetyData } = useQuery({
    queryKey: ['exec-safety'],
    queryFn: () => apiClient.get<{ data: SafetyData }>('/api/v1/executive/clinical/safety'),
  });
  const { data: infectionData } = useQuery({
    queryKey: ['exec-infection'],
    queryFn: () => apiClient.get<{ data: InfectionData }>('/api/v1/executive/clinical/infection'),
  });
  const { data: weeklyData } = useQuery({
    queryKey: ['exec-clinical-weekly'],
    queryFn: () => apiClient.get<{ data: WeeklyData }>('/api/v1/executive/clinical/weekly-trend'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const ov = overview?.data;
  const _doctorsRaw = doctorsData?.data;
  const doctors: DoctorPerf[] = Array.isArray(_doctorsRaw) ? _doctorsRaw : (_doctorsRaw as unknown as { data?: DoctorPerf[] })?.data ?? [];
  const safety = safetyData?.data;
  const infection = infectionData?.data;
  const weekly = weeklyData?.data;

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="의료 품질 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1">
            {greeting}, {user?.familyName}{user?.givenName}님 &middot; {kdate(today, 'dateWeekday')}
          </p>
        </div>
        <Link href="/executive" className="px-4 py-2.5 bg-slate-700 text-white text-sm font-semibold rounded-xl hover:bg-slate-800 transition-colors">
          ← <T k="경영 대시보드" />
        </Link>
      </div>

      {/* Clinical Overview Cards */}
      {ov && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard title={tAttr('오늘 진료')} value={`${ov.todayEncounters}건`} subtitle={`예약 ${ov.totalAppointments}건`} color="blue" />
          {/* 🔴 '현재 대기'에 createdAt=오늘 필터가 걸려 어제부터 대기 중인 환자가 사라졌었다 → 접수일 무관 */}
          <StatCard title={tAttr('외래 대기')} value={`${ov.waitingPatients}명`} subtitle={ov.waitingBasis ?? tAttr('현재 대기중')} color="amber" />
          <StatCard title={tAttr('입원 환자')} value={`${ov.inpatients}명`} subtitle={tAttr('현재 재원')} color="indigo" />
          <StatCard title={tAttr('ICU 환자')} value={`${ov.icuPatients}명`} subtitle={tAttr('중환자실')} color="red" />
          {/* 🔴 조회 실패를 "0건"(=사고 없음)으로 말하지 않는다 */}
          <StatCard
            title={tAttr('안전사고')}
            value={safety?.unavailable ? tAttr('조회 실패') : `${n2s(safety?.totalIncidents)}건`}
            subtitle={safety?.unavailable ? tAttr('집계 불가 — 확인 필요') : tAttr('이번달')}
            color="orange"
          />
        </div>
      )}

      {/* Doctor Performance Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900"><T k="작성자별 진료 실적 · 미완료 차트" /></h3>
          {/* 🔴 종전엔 role=DOCTOR 만 표에 올려, 나머지 계정 소유의 미완료 차트는 담당자가 어느 화면에도 없었다 */}
          <Link href="/admin/him" className="text-xs text-blue-600 hover:underline"><T k="미비기록 목록" /> →</Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="작성자" /></th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="진료과" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="오늘진료" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="주간합계" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="대기환자" /></th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500"><T k="미완료차트" /></th>
            </tr>
          </thead>
          <tbody>
            {doctors.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm"><T k="데이터 없음" /></td></tr>
            ) : doctors.map((d) => (
              <tr key={d.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {d.name}
                  {/* 의사 계정이 아닌 작성자는 그 사실을 적는다 — 숨기면 미완료 차트의 담당자가 사라진다 */}
                  {d.isDoctor === false && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500"><T k={d.role ?? '비의사'} /></span>}
                  {d.isActive === false && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-50 text-rose-600"><T k="비활성" /></span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{d.department}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">{d.todayEncounters}<Unit>건</Unit></td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{d.weekEncounters}<Unit>건</Unit></td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.waitingPatients > 0 ? (
                    <span className="text-amber-600 font-medium">{d.waitingPatients}<Unit>명</Unit></span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.incompleteCharts > 0 ? (
                    <span className="text-red-500 font-medium">{d.incompleteCharts}<Unit>건</Unit></span>
                  ) : (
                    <span className="text-emerald-500 font-medium">0건</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Safety + Infection Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Safety */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="안전/질관리 (이번달)" /></h3>
          {!safety ? (
            <p className="text-sm text-gray-400 text-center py-4"><T k="로딩중..." /></p>
          ) : safety.unavailable ? (
            /* 🔴 종전 `.catch(() => [])` — 조회 실패가 "안전사고 0건"으로 둔갑했다 */
            <p className="text-sm text-red-600 text-center py-4">안전사고 집계를 불러오지 못했습니다 — 0건이 아니라 <b>확인 불가</b>입니다.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600"><T k="총 안전사고" /></span>
                <span className="text-lg font-bold text-gray-900">{n2s(safety.totalIncidents)}<Unit>건</Unit></span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-red-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-red-700">{n2s(safety.falls)}</p>
                  <p className="text-[11px] text-red-600 font-medium"><T k="낙상" /></p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-amber-700">{n2s(safety.medicationErrors)}</p>
                  <p className="text-[11px] text-amber-600 font-medium"><T k="투약오류" /></p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-gray-700">{n2s(safety.others)}</p>
                  <p className="text-[11px] text-gray-600 font-medium"><T k="기타" /></p>
                </div>
              </div>
              {/* '기타' 를 한 덩어리로 감추지 않는다 — 실제 유형을 그대로 보여준다 */}
              {!!safety.byType?.length && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {safety.byType.map((t) => (
                    <span key={t.type} className="px-2 py-0.5 rounded-full bg-gray-50 text-[11px] text-gray-600 border border-gray-100">
                      {t.type} {t.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Infection */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="감염관리" /></h3>
          {!infection ? (
            <p className="text-sm text-gray-400 text-center py-4"><T k="로딩중..." /></p>
          ) : infection.unavailable ? (
            <p className="text-sm text-red-600 text-center py-4">감염 감시 자료를 불러오지 못했습니다 — 0건이 아니라 <b>확인 불가</b>입니다.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600"><T k="활성 감염" /></span>
                <span className="text-lg font-bold text-gray-900">{n2s(infection.active)}<Unit>건</Unit></span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {/* 🔴 `organism === 'MRSA'` 완전일치는 학명 컬럼과 만나지 않아 **구조적으로 항상 0** 이었다.
                     지금은 내성이 명시된 건만 세고, 판정 불가는 옆 칸에 따로 드러낸다. */}
                <div className="bg-purple-50 rounded-xl p-3 text-center" title={infection.mrsaBasis}>
                  <p className="text-lg font-bold text-purple-700">{n2s(infection.mrsa)}</p>
                  <p className="text-[11px] text-purple-600 font-medium"><T k="MRSA(내성 명시)" /></p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center" title={tAttr('황색포도알균이지만 내성 표기가 없어 MRSA/MSSA 판정 불가')}>
                  <p className="text-lg font-bold text-amber-700">{n2s(infection.sAureusUnclassified)}</p>
                  <p className="text-[11px] text-amber-600 font-medium"><T k="S.aureus 판정불가" /></p>
                </div>
                <div className="bg-orange-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-orange-700">{n2s(infection.isolated)}</p>
                  <p className="text-[11px] text-orange-600 font-medium"><T k="격리환자" /></p>
                </div>
              </div>
              {/* 균주 분포는 실데이터 — '기타균' 한 덩어리로 지우면 S. aureus 1건이 화면에서 사라진다 */}
              {infection.organisms?.length ? (
                <div className="pt-1 space-y-1">
                  {infection.organisms.slice(0, 6).map((o) => (
                    <div key={o.name} className="flex justify-between text-xs">
                      <span className="text-gray-600 italic">{o.name}</span>
                      <span className="font-medium text-gray-800">{o.count}<Unit>건</Unit></span>
                    </div>
                  ))}
                  {(infection.organismUnknown ?? 0) > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400"><T k="균주 미기재" /></span>
                      <span className="font-medium text-gray-500">{infection.organismUnknown}<Unit>건</Unit></span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 pt-1"><T k="활성 감염 건이 없습니다." /></p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Weekly Department Trend */}
      {weekly && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900"><T k="진료과별 주간 추이" /></h3>
            {/* 🔴 종전엔 6개 과를 하드코딩해 나머지를 잘라낸 뒤 그 합을 총량처럼 보여줬다 → 축은 실데이터에서 만든다 */}
            <span className="text-[11px] text-gray-400"><T k={weekly.basis ?? '최근 7일 실데이터'} />{weekly.total != null && ` · 총 ${weekly.total}건`}</span>
          </div>
          {weekly.departments.length === 0 ? (
            <p className="py-8 text-center text-gray-400 text-sm"><T k="최근 7일 진료 기록이 없습니다." /></p>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500"><T k="요일" /></th>
                  {weekly.departments.map((d: string) => (
                    <th key={d} className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">{d}</th>
                  ))}
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 border-l border-gray-100"><T k="합계" /></th>
                </tr>
              </thead>
              <tbody>
                {weekly.days.map((day, i) => {
                  const dayName = DAY_LABELS[parseDayKey(day.date).getDay()];
                  // 서버가 낸 total(그날 전체)을 우선 쓴다 — 열의 합과 총량이 갈라지지 않게
                  const total = day.total != null ? Number(day.total) : weekly.departments.reduce((s: number, d: string) => s + (Number(day[d]) || 0), 0);
                  const isToday = i === weekly.days.length - 1;
                  return (
                    <tr key={day.date} className={`border-b border-gray-50 ${isToday ? 'bg-blue-50/50' : ''}`}>
                      <td className={`px-3 py-2.5 font-medium ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>
                        {dayName} <span className="text-gray-400 text-[10px]">{day.date.slice(5)}</span>
                      </td>
                      {weekly.departments.map((d: string) => (
                        <td key={d} className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                          {Number(day[d]) > 0 ? day[d] : <span className="text-gray-200">-</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900 border-l border-gray-100">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

/* StatCard: moved to @/components/ui/StatCard */
