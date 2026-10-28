'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import BeforeAfterSlider from '@/components/specialty/BeforeAfterSlider';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';

const PHOTO_ANGLES = ['정면', '좌45', '우45', '좌90', '우90', '하면'];

type PlasticTab = 'records' | 'photos';

// fitzpatrickType 은 Int(1~6) — 환자 차트 탭(PlasticTab.tsx)과 같은 어휘를 쓴다(정본 하나)
const FITZPATRICK_LABEL: Record<string, string> = {
  I: 'I (매우 밝음)', II: 'II (밝음)', III: 'III (보통)', IV: 'IV (올리브)', V: 'V (갈색)', VI: 'VI (어두움)',
};
const FITZ_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const fmtFitzpatrick = (v: unknown): string => {
  if (v == null) return '-';
  const roman = typeof v === 'number' ? FITZ_ROMAN[v] : String(v);
  return FITZPATRICK_LABEL[roman] ?? String(v);
};

/** `photoAngles` 는 `[{angle,url}]`(스키마 주석). 다른 모양이면 지어내지 않고 버린다. */
function anglesOf(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const p of raw as Array<Record<string, unknown>>) {
    if (typeof p?.angle === 'string' && typeof p?.url === 'string' && p.url) out[p.angle] = p.url;
  }
  return out;
}

/** `beforePhotoUrls`/`afterPhotoUrls` 는 URL 목록. 단일 문자열도 허용하되 그 밖의 모양은 버린다. */
function urlsOf(raw: unknown): string[] {
  if (typeof raw === 'string') return raw ? [raw] : [];
  if (Array.isArray(raw)) return raw.filter((u): u is string => typeof u === 'string' && !!u);
  return [];
}

export default function PlasticPage() {
  const tAttr = useTAttr();
  const [showLegacy, setShowLegacy] = useState(false);
  const [tab, setTab] = useState<PlasticTab>('records');
  const [patientId, setPatientId] = useState('');

  // ── Dashboard data ──
  const { data: todayData, isLoading: todayLoading, isError, error, refetch } = useQuery({
    queryKey: ['plastic-today'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/plastic/today'),
  });
  const { data: statsData, isLoading: statsLoading, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['plastic-stats'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/plastic/stats'),
  });
  const { data: patientsData, isLoading: patientsLoading, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['plastic-patients'],
    queryFn: () => apiClient.get<{ data: Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> }>('/api/v1/plastic/patients'),
  });
  const myPatients = (() => { const r = patientsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Array<{ patientId: string; familyName: string | null; givenName: string | null; mrn: string | null; lastDate: string }> ?? []; })();
  const todayPatients: Record<string, unknown>[] = (() => { const r = todayData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const stats: Record<string, unknown> = (() => { const r = statsData?.data; if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in (r as unknown as Record<string, unknown>)) return (r as unknown as Record<string, unknown>).data as Record<string, unknown>; return (r ?? {}) as Record<string, unknown>; })();

  // ── 개별 환자 조회 ──
  // 🔴 종전 이 화면은 `plastic/records/:id` · `plastic/photos/:id` 를 불렀다. 컨트롤러에 그런 라우트가
  //    없어(전체 라우트 = patients · exams/:patientId · exams · today · stats) **개통 이래 100% 실패**,
  //    운영 PlasticExam 217건(103명)이 이 화면에 한 번도 보인 적이 없다.
  //    정본 EP 는 `exams/:patientId` 하나이고 시술기록·사진이 같은 행에 들어 있다(PlasticExam.photoAngles /
  //    beforePhotoUrls / afterPhotoUrls) — 두 탭이 같은 조회를 공유한다.
  const { data: examsData, isLoading: examsLoading, isError: examsIsError, error: examsError, refetch: refetchExams } = useQuery({
    queryKey: ['plastic-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/plastic/exams/${patientId}`),
    enabled: !!patientId && showLegacy,
  });

  const records: Record<string, unknown>[] = (() => { const r = examsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  // 사진이 실제로 붙어 있는 시술기록만 — 없는 것을 '기록 없음'이 아니라 "사진이 없다"고 말한다
  const photoRecords = records
    .map((row) => ({ row, angles: anglesOf(row.photoAngles), beforeUrls: urlsOf(row.beforePhotoUrls), afterUrls: urlsOf(row.afterPhotoUrls) }))
    .filter((p) => Object.keys(p.angles).length > 0 || p.beforeUrls.length > 0 || p.afterUrls.length > 0);


  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="성형외과 대시보드" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="오늘의 현황 / 환자 목록 / 시술·사진 관리" /></p>
        </div>
      </div>

      {/* ── 상단: 오늘의 현황 카드 ── 🔴 통계 조회 실패를 "0건"으로 말하지 않는다 */}
      {statsIsError && <div className="mb-6"><QueryErrorFallback error={statsError} onRetry={refetchStats} size="compact" /></div>}
      {!statsIsError && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="h-4 w-16 bg-gray-100 rounded animate-pulse mb-2" />
              <div className="h-8 w-12 bg-gray-100 rounded animate-pulse" />
            </div>
          ))
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="오늘 예약" /></p>
              <p className="text-2xl font-bold text-gray-900">{Number(stats.todayAppointments ?? stats.totalAppointments ?? todayPatients.length ?? 0)}</p>
              {/* 🔴 노쇼는 총계에는 들어가는데 완료·진행·대기 어디에도 없어 "예약 1 / 나머지 0" 으로 보였다 —
                  의사는 "아직 안 왔다"로 읽지만 이미 노쇼 확정이다. 4칸 합 + 노쇼 = 총계. */}
              {Number(stats.noShow ?? 0) > 0 && (
                <p className="text-[11px] font-bold text-rose-600 mt-0.5"><T k="노쇼" /> {Number(stats.noShow)}</p>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="완료" /></p>
              <p className="text-2xl font-bold text-emerald-600">{Number(stats.completedToday ?? stats.completed ?? 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="진행 중" /></p>
              <p className="text-2xl font-bold text-blue-600">{Number(stats.inProgressToday ?? stats.inProgress ?? 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1"><T k="대기" /></p>
              <p className="text-2xl font-bold text-amber-600">{Number(stats.waitingToday ?? stats.waiting ?? 0)}</p>
            </div>
          </>
        )}
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
            {patientsIsError ? <tr><td colSpan={4} className="px-4 py-3"><QueryErrorFallback error={patientsError} onRetry={refetchPatients} size="compact" /></td></tr>
            : patientsLoading ? <LoadingRows cols={4} />
            : myPatients.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="성형외과 기록이 있는 환자가 없습니다" /></td></tr>
            ) : myPatients.map((p) => (
              <tr key={p.patientId} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-medium text-gray-900">{`${p.familyName ?? ''}${p.givenName ?? ''}`}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{p.mrn ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.lastDate ? kdate(p.lastDate) : '-'}</td>
                <td className="px-4 py-3">
                  <Link href={`/patients/${p.patientId}?tab=plastic`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술 내용" /></th>
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
                      <Link href={`/patients/${pid}?tab=plastic`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
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
                { key: 'records' as PlasticTab, label: '시술기록' },
                { key: 'photos' as PlasticTab, label: '전후사진' },
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
              ))}
            </div>

            {/* 시술기록 */}
            {tab === 'records' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  {/* 🔴 칸 어휘는 모델(PlasticExam)에 맞춘다 — 종전 procedureDate·site·procedureName·
                      anesthesia·status 는 **서버에 없는 필드**라 EP 를 고쳐도 전부 '-' 였다.
                      status 칸은 아예 뺐다: PlasticExam 에 상태 컬럼이 없다(StatusBadge domain="plan" 에
                      빈 값을 넘겨 없는 상태를 그리고 있었다). */}
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술일" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="마취" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="재료" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Fitzpatrick</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소요시간" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="집도의" /></th>
                  </tr></thead>
                  <tbody>
                    {!patientId ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></td></tr>
                    : examsIsError ? <tr><td colSpan={8} className="px-4 py-3"><QueryErrorFallback error={examsError} onRetry={refetchExams} size="compact" /></td></tr>
                    : examsLoading ? <LoadingRows cols={8} />
                    : records.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="시술기록 없음" /></td></tr>
                    : records.map((r) => {
                      const ex = r.examiner as Record<string, unknown> | undefined;
                      return (
                      <tr key={r.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-xs text-gray-400">{r.examinedAt ? kdate(r.examinedAt as string) : '-'}</td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{(r.bodyPart as string) ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{(r.procedure as string) ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{(r.anesthesiaType as string) ?? '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{(r.material as string) ?? '-'}</td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-100 text-violet-700">
                            {fmtFitzpatrick(r.fitzpatrickType)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">{r.duration != null ? `${r.duration}분` : '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{ex ? `${(ex.familyName as string) ?? ''}${(ex.givenName as string) ?? ''}` : '-'}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 전후사진 — 정본은 시술기록(PlasticExam)의 photoAngles / beforePhotoUrls / afterPhotoUrls.
                🔴 종전 이 탭은 없는 EP(`plastic/photos/:id`)를 부르고 서버에 없는 어휘(angles·phase·
                   photoDate·beforeUrl·afterUrl)를 읽었으며, 조건이 참일 때 슬라이더를 **인자 없이**
                   렌더해 비교 자료가 있는 것처럼 보이는 빈 상자를 그렸다. */}
            {tab === 'photos' && (
              <div className="space-y-4">
                {!patientId ? (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-400"><T k="환자 ID를 입력하세요" /></div>
                ) : examsIsError ? (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <QueryErrorFallback error={examsError} onRetry={refetchExams} size="compact" />
                  </div>
                ) : examsLoading ? (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12">
                    <div className="h-4 bg-gray-100 rounded animate-pulse" />
                  </div>
                ) : records.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-400"><T k="시술기록 없음" /></div>
                ) : photoRecords.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-400">
                    시술기록 {records.length}건에 등록된 사진이 없습니다
                  </div>
                ) : photoRecords.map(({ row, angles, beforeUrls, afterUrls }) => (
                  <div key={row.id as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-gray-900">{(row.procedure as string) ?? '시술'} - {row.examinedAt ? kdate(row.examinedAt as string) : '-'}</h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-700">
                        {(row.bodyPart as string) ?? '-'}
                      </span>
                    </div>
                    {Object.keys(angles).length > 0 && (
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {PHOTO_ANGLES.map((angle) => {
                          const url = angles[angle];
                          return (
                            <div key={angle} className="text-center">
                              <p className="text-[10px] text-gray-500 mb-1 whitespace-nowrap"><T k={angle} /></p>
                              {url ? (
                                <div className="w-full aspect-square bg-gray-100 rounded-lg overflow-hidden">
                                  <img src={url} alt={angle} className="w-full h-full object-cover" />
                                </div>
                              ) : (
                                <div className="w-full aspect-square bg-gray-50 rounded-lg flex items-center justify-center">
                                  <span className="text-[10px] text-gray-300"><T k="없음" /></span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* 🔴 슬라이더는 비교할 두 장이 실제로 있을 때만 — 한쪽만 있으면 그 사실을 말한다 */}
                    {beforeUrls[0] && afterUrls[0] ? (
                      <div className="mt-3">
                        <BeforeAfterSlider beforeUrl={beforeUrls[0]} afterUrl={afterUrls[0]} beforeLabel={tAttr('시술 전')} afterLabel={tAttr('시술 후')} />
                      </div>
                    ) : (beforeUrls[0] || afterUrls[0]) ? (
                      <p className="text-xs text-gray-500">
                        {beforeUrls[0] ? <T k="시술 전" /> : <T k="시술 후" />} <T k="사진만 있어 비교할 수 없습니다" />
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
