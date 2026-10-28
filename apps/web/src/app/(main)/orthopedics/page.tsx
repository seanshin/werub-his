'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import SkeletonDiagram from '@/components/specialty/SkeletonDiagram';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { orthoRomRows, orthoSpecialTestRows } from '@/lib/specialty/exam-views';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';


type OrthoTab = 'exams' | 'rom' | 'specialTests';

// 좌/우·부위 라벨 — 서버 실제 필드는 side·bodyPart(FE 는 없는 이름 site·findings·examDate 를 읽고 있었다)
const SIDE_LABEL: Record<string, string> = { LEFT: '좌(L)', RIGHT: '우(R)', BILATERAL: '양측' };
const BODY_PART_LABEL: Record<string, string> = {
  SHOULDER: '어깨', ELBOW: '팔꿈치', WRIST: '손목', HIP: '고관절', KNEE: '무릎', ANKLE: '발목',
  SPINE_C: '경추', SPINE_T: '흉추', SPINE_L: '요추',
};

export default function OrthopedicsPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<OrthoTab>('exams');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError: todayError, error: todayErr, refetch: todayRefetch } = useQuery({
    queryKey: ['orthopedics-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/orthopedics/today'),
  });
  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['orthopedics-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/orthopedics/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['orthopedics-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/orthopedics/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();
  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── 개별 환자 조회 — 정본은 `exams/:patientId` 하나다 ──
  //    🔴 ROM·특수검사는 별도 EP 가 아니라 OrthoExam 의 `rom`·`specialTests` JSONB 다.
  //       종전엔 없는 `orthopedics/{rom,special-tests}` 를 부르고 404 를 삼켜 두 탭이
  //       개통 이래 영구히 "기록 없음"이었다(2026-08-18 이연 회수).
  const { data: examsData, isLoading: examsLoading, isError: examsError } = useQuery({
    queryKey: ['orthopedics-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/orthopedics/exams/${patientId}`),
    enabled: !!patientId && showLegacy,
  });

  const exams: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const romRecords = orthoRomRows(exams);
  const specialTests = orthoSpecialTestRows(exams);


  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );
  // 🔴 조회 실패를 '기록 없음'으로 말하지 않는다 — 둘은 다른 사실이다.
  const ErrorRow = ({ cols }: { cols: number }) => (
    <tr><td colSpan={cols} className="py-12 text-center text-sm text-red-600"><T k="조회에 실패했습니다 — 기록이 없는 것이 아니라 불러오지 못했습니다" /></td></tr>
  );

  if (todayError) return <QueryErrorFallback error={todayErr} onRetry={todayRefetch} />;

  return (
    <div>
      <PageHeader title={tAttr('정형외과 대시보드')} />

      {/* ── 상단: 오늘의 현황 카드 — 🔴 통계 조회 실패에 0 을 그리지 않는다 ── */}
      {statsIsError ? (
        <div className="mb-6"><QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard title={tAttr('오늘 예약')} value={Number(stats.todayAppointments ?? stats.totalAppointments ?? todayPatients.length ?? 0)} color="gray" />
          <StatCard title={tAttr('완료')} value={Number(stats.completedToday ?? stats.completed ?? 0)} color="emerald" />
          <StatCard title={tAttr('진행 중')} value={Number(stats.inProgressToday ?? stats.inProgress ?? 0)} color="blue" />
          <StatCard title={tAttr('대기')} value={Number(stats.waitingToday ?? stats.waiting ?? 0)} color="amber" />
        </div>
      )}

      {/* ── 내 환자 목록 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900"><T k="이 과 기록이 있는 환자" /></h3>
          <SpecialtyPatientListMeta meta={specialtyPatientMeta(patientsData)} />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">MRN</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="최근 진료일" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="차트" /></th>
            </tr>
          </thead>
          <tbody>
            {patientsIsError ? <tr><td colSpan={4} className="p-3"><QueryErrorFallback error={patientsError} onRetry={() => refetchPatients()} size="compact" /></td></tr>
            : patientsLoading ? <LoadingRows cols={4} />
            : myPatients.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="정형외과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=orthopedics`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <T k="차트 열기" /> &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 오늘 환자 목록 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900"><T k="오늘 환자 목록" /></h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진료 내용" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="차트" /></th>
            </tr>
          </thead>
          <tbody>
            {todayLoading ? <LoadingRows cols={5} />
            : todayPatients.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="오늘 예약된 환자가 없습니다" /></td></tr>
            ) : todayPatients.map((p, idx) => {
              const pid = (p.patientId ?? p.patient_id ?? (p.patient as unknown as Record<string, unknown>)?.id) as string | undefined;
              const patientObj = p.patient as Record<string, unknown> | undefined;
              const name = patientObj
                ? `${(patientObj.familyName as string) ?? ''}${(patientObj.givenName as string) ?? ''}`
                : (p.patientName as string) ?? '-';
              const time = (p.scheduledAt ?? p.appointmentTime ?? p.time) as string | undefined;
              const timeStr = time ? kdate(time, 'time') : (p.timeSlot as string) ?? '-';
              const treatment = (p.treatment ?? p.procedure ?? p.reason ?? p.chiefComplaint) as string ?? '-';
              // 데이터원 = 오늘 예약(Appointment) → 상태 도메인도 appointment(종전 plan 도메인은
              // SCHEDULED·CONFIRMED·CHECKED_IN·NO_SHOW 를 몰라 영문 원문을 노출했다)
              const status = (p.status as string) ?? '';
              return (
                <tr key={`${pid ?? idx}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs text-gray-700">{timeStr}</td>
                  <td className="px-4 py-3 text-xs font-medium text-gray-900">{name}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{treatment}</td>
                  <td className="px-4 py-3">
                    <StatusBadge domain="appointment" status={status} className="text-[10px] font-bold whitespace-nowrap" />
                  </td>
                  <td className="px-4 py-3">
                    {pid ? (
                      <Link href={`/patients/${pid}?tab=orthopedics`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        <T k="차트 열기" /> &rarr;
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── 하단: 개별 환자 조회 (접기/펼치기) ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowLegacy(!showLegacy)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors"
        >
          <span className="text-sm font-bold text-gray-700"><T k="개별 환자 조회" /></span>
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${showLegacy ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showLegacy && (
          <div className="border-t border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-80" data-specialty-patient-picker><PatientSelector value={patientId} onChange={(id) => setPatientId(id)} /></div>
            </div>

            <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
              {([
                { key: 'exams' as OrthoTab, label: '검사기록' },
                { key: 'rom' as OrthoTab, label: 'ROM차트' },
                { key: 'specialTests' as OrthoTab, label: '특수검사' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 검사기록 */}
            {tab === 'exams' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <SkeletonDiagram selectedPart={null} onPartClick={() => {}} view="front" />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
                      {/* 🔴 좌/우가 DB 에 있는데 표에 열 자체가 없었다 — 수술 부위 오류에 직결(2026-08-13 W4) */}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="좌/우" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단명" /></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Pain VAS</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소견" /></th>
                    </tr></thead>
                    <tbody>
                      {!patientId ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                      : examsLoading ? <LoadingRows cols={6} />
                      : examsError ? <ErrorRow cols={6} />
                      : exams.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="검사기록 없음" /></td></tr>
                      : exams.map((e) => (
                        <tr key={e.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-400">{e.examinedAt ? kdate(e.examinedAt as string) : '-'}</td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900"><T k={BODY_PART_LABEL[String(e.bodyPart ?? '')] ?? (e.bodyPart as string) ?? '-'} /></td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-900"><T k={SIDE_LABEL[String(e.side ?? '')] ?? '미기재'} /></td>
                          <td className="px-4 py-3 text-xs text-gray-700">{(e.diagnosis as string) ?? '-'}</td>
                          <td className="px-4 py-3">
                            {/* 🔴 미측정 VAS 를 0(통증 없음·초록)으로 단정하지 않는다 */}
                            {typeof e.painVas !== 'number' ? <span className="text-xs text-gray-400"><T k="미측정" /></span> : (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${e.painVas >= 7 ? 'bg-red-100 text-red-700' : e.painVas >= 4 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                VAS {e.painVas}/10
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{(e.imagingFindings as string) ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ROM차트 */}
            {tab === 'rom' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위 · 좌/우 · 운동" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="정상 (도)" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="측정값 (도)" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="측정일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsLoading ? <LoadingRows cols={5} />
                    : examsError ? <ErrorRow cols={5} />
                    : romRecords.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="ROM 기록 없음" /></td></tr>
                    : romRecords.map((r) => {
                      // 🔴 ROM 0도 = 관절 강직(완전 운동제한)이라는 실제 값이다 — `|| '-'` 로 감추면
                      //    "기록 없음"처럼 읽힌다(W2 ICU 배설량 0 은닉과 같은 병·2026-08-13 W4).
                      const limited = r.measured != null && r.normal != null && r.normal > 0 && r.measured < r.normal * 0.8;
                      return (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs font-medium text-gray-900">
                            <T k={BODY_PART_LABEL[r.bodyPart ?? ''] ?? r.bodyPart ?? '-'} />
                            {' · '}<T k={SIDE_LABEL[r.side ?? ''] ?? '미기재'} />
                            {' · '}{r.movement ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700">{r.normal ?? '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold ${limited ? 'text-red-600' : r.measured == null ? 'text-gray-400' : 'text-gray-900'}`}>{r.measured ?? <T k="미측정" />}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">{r.measuredAt ? kdate(r.measuredAt) : '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{r.notes ?? '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 특수검사 */}
            {tab === 'specialTests' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="결과" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위 · 좌/우" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검사일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsLoading ? <LoadingRows cols={5} />
                    : examsError ? <ErrorRow cols={5} />
                    : specialTests.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="특수검사 기록 없음" /></td></tr>
                    : specialTests.map((t) => (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{t.testName ?? '-'}</td>
                        <td className="px-4 py-3">
                          {/* 🔴 아는 결과만 판정한다 — 판독 불가·미기재를 음성(초록)으로 접으면 거짓 안심이다 */}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${t.resultKind === 'POSITIVE' ? 'bg-red-100 text-red-700' : t.resultKind === 'NEGATIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            <T k={t.result ?? '미기재'} />
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">
                          <T k={BODY_PART_LABEL[t.bodyPart ?? ''] ?? t.bodyPart ?? '-'} />
                          {' · '}<T k={SIDE_LABEL[t.side ?? ''] ?? '미기재'} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{t.testedAt ? kdate(t.testedAt) : '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{t.notes ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
