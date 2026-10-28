'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { EmptyState } from '@/components/ui/display';
import { JourneyTab } from '../patients/[id]/components/JourneyTab';

// 질관리 지표 한글 라벨·단위 — BE journey/metrics 실측 키(avgOutpatientWaitMinutes 등)
// 라벨·단위는 i18n 키다 — 단위는 `@단위` 문맥 키(맨 키 `시간`=Time 열 머리글 뜻과 갈린다 · 표시 부품 Unit 과 같은 규칙)
const METRIC_LABEL: Record<string, { label: string; unit: string }> = {
  avgOutpatientWaitMinutes: { label: '외래 평균 대기', unit: '분@단위' },
  // 2026-10-03 결정 D8 — 접수 → 수납 완료
  avgOutpatientStayMinutes: { label: '외래 평균 체류', unit: '분@단위' },
  avgErStayHours: { label: '응급실 평균 체류', unit: '시간@단위' },
  avgLengthOfStayDays: { label: '평균 재원일수', unit: '일@단위' },
  readmissionRate30Days: { label: '30일 재입원율', unit: '%' },
};

/**
 * 지표가 아니라 **지표의 근거**인 필드 — 타일로 그리지 않고 각주로 붙인다.
 * 🔴 W8: 서버가 `outpatientWaitSampleN` 을 추가하자 라벨 없는 영문 key 타일이 그대로 노출됐다.
 *    (외래 완료 462건 중 진료 시작 시각이 있는 것은 13건뿐이라, 이 표본 수는 값 자체보다 중요하다.)
 */
const SAMPLE_OF: Record<string, string> = {
  avgOutpatientWaitMinutes: 'outpatientWaitSampleN',
  avgOutpatientStayMinutes: 'outpatientStaySampleN',
  // 🔴 (2026-10-01 여정 P0-1) 재원일수·재입원율도 표본 0 이면 null — 종전 서버는 0 을 냈다
  avgErStayHours: 'erVisitSampleN',
  avgLengthOfStayDays: 'admissionSampleN',
  readmissionRate30Days: 'dischargeSampleN',
};
/** 지표가 산출 불가인 **이유**(서버가 밝힌 것) — 타일 각주로 */
const REASON_OF: Record<string, string> = {
  avgErStayHours: 'erStayUnavailableReason',
};
const REASON_TEXT: Record<string, string> = {
  // 2026-10-03 결정 D9 — 퇴실 시각 칸. 결정 이후 퇴실 확정분부터 쌓인다
  NO_DEPARTURE_RECORDED: '기간 안 퇴실 시각이 기록된 방문이 없어 계산하지 않음',
};
/**
 * 지표에서 **뺀 것**(서버가 센 것) — 타일 각주로. 🔴 (2026-10-01) 재원일수는 퇴원<입원(데이터 결함)을 1일로 감싸 평균에 섞지 않고 뺀다.
 * 빼고도 말하지 않으면 표본이 줄어든 이유를 아무도 모른다.
 */
const EXCLUDED_OF: Record<string, string> = {
  avgLengthOfStayDays: 'lengthOfStayExcluded',
  // 수납 전·미수 / 퇴실 시각 없음(진행 중·자동 종결·기록 이전)은 뺀다
  avgOutpatientStayMinutes: 'outpatientStayExcluded',
  avgErStayHours: 'erStayExcluded',
};
/** 뺀 것의 문장 — 지표마다 뺀 이유가 다르다 */
const EXCLUDED_TEXT: Record<string, string> = {
  avgLengthOfStayDays: '퇴원일이 입원일보다 이르거나 날짜가 없어 {수}건 제외',
  avgOutpatientStayMinutes: '수납 전·미수 {수}건 제외',
  avgErStayHours: '진행 중이거나 퇴실 시각이 없는 {수}건 제외',
};
/** 모집단 문구 — 같은 이름의 지표가 다른 화면에선 다른 모집단일 수 있어 여기서 밝힌다(지표 정의서 §5.10) */
const POPULATION_OF: Record<string, string> = {
  avgLengthOfStayDays: '기간 안 퇴원 기준',
  avgOutpatientStayMinutes: '접수 → 수납 완료',
  avgErStayHours: '도착 → 퇴실 시각',
};
const SUPPORT_KEYS = new Set([...Object.values(SAMPLE_OF), ...Object.values(REASON_OF), ...Object.values(EXCLUDED_OF)]);


export default function JourneyDashboardPage() {
  const tAttr = useTAttr();
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientName, setSelectedPatientName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // 환자 검색 — 🔴 실패를 "결과 없음"으로 그리지 않는다(드롭다운이 조용히 비던 자리)
  const { data: patientsRes, isError: patientsError } = useQuery({
    queryKey: ['journey-patients', patientSearch],
    queryFn: () => apiClient.get<any>('/api/v1/patients', { q: patientSearch, limit: 10 }),
    enabled: patientSearch.length >= 1,
  });
  const patients = patientsRes?.data ?? [];

  // 질관리 지표
  const { data: metricsRes, isLoading: metricsLoading, isError: metricsError, error: metricsErr, refetch: metricsRefetch } = useQuery({
    queryKey: ['journey-metrics', dateFrom, dateTo],
    queryFn: () => apiClient.get<any>('/api/v1/journey/metrics', {
      ...(dateFrom ? { from: dateFrom } : {}),
      ...(dateTo ? { to: dateTo } : {}),
    }),
  });
  const metrics = metricsRes?.data;


  const selectPatient = (p: any) => {
    setSelectedPatientId(p.id);
    setSelectedPatientName(`${p.familyName}${p.givenName}`);
    setPatientSearch('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="환자 여정 대시보드" /></h1>
        <p className="text-sm text-gray-500 mt-0.5"><T k="환자별 여정 이벤트 타임라인 및 질관리 지표" /></p>
      </div>

      {/* 필터 */}
      <div className="bg-white border rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* 환자 검색 */}
          <div className="flex-1 min-w-[200px] relative">
            <label className="text-xs text-gray-500 mb-1 block"><T k="환자 검색" /></label>
            <input
              type="text"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder={tAttr('이름 또는 MRN...')}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {patients.length > 0 && patientSearch && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                {patients.map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => selectPatient(p)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0"
                  >
                    <span className="font-medium">{p.familyName}{p.givenName}</span>
                    <span className="text-gray-400 ml-2">{p.mrn}</span>
                  </button>
                ))}
              </div>
            )}
            {patientsError && patientSearch && (
              <p role="alert" className="mt-1 text-xs text-rose-600"><T k="환자 검색에 실패했습니다 — 다시 입력해 보세요" /></p>
            )}
            {selectedPatientId && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{selectedPatientName}</span>
                <button type="button" onClick={() => { setSelectedPatientId(null); setSelectedPatientName(''); }}
                  aria-label={tAttr('환자 선택 해제')} className="rounded px-1.5 text-xs text-gray-400 hover:text-red-500">✕</button>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block"><T k="지표 기간 시작" /></label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><T k="지표 기간 끝" /></label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* 질관리 지표 */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-2xl p-5 text-white">
        <h2 className="text-sm font-bold mb-3"><T k="질관리 지표" /></h2>
        {metricsError ? (
          // 🔴 지표 하나가 실패해도 환자 검색·타임라인은 쓸 수 있어야 한다(종전: 페이지 전체를 오류 화면으로 바꿨다)
          <div className="rounded-xl bg-white p-2"><QueryErrorFallback error={metricsErr} onRetry={metricsRefetch} size="compact" /></div>
        ) : metricsLoading ? (
          <p className="text-xs text-slate-400"><T k="로딩 중..." /></p>
        ) : metrics ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Object.entries(metrics)
              .filter(([, value]) => value === null || typeof value !== 'object') // period 등 객체 값 제외(React #31 방지)
              // 🔴 이 그리드는 **스칼라를 전부 타일로** 그린다 — 서버가 필드를 하나 추가하면
              //    한글 라벨 없이 영문 key 가 그대로 노출된다(W8 에서 `outpatientWaitSampleN` 이 그랬다).
              //    표본 수는 지표가 아니라 **지표의 근거**다. 타일이 아니라 각주로 붙인다.
              .filter(([key]) => !SUPPORT_KEYS.has(key))
              .map(([key, value]: [string, any]) => {
                // 지표 한글 라벨·단위(종전 영문 raw key 노출)
                const meta = METRIC_LABEL[key] ?? { label: key, unit: '' };
                const sampleN = SAMPLE_OF[key] ? (metrics as any)[SAMPLE_OF[key]] : undefined;
                const reason = REASON_OF[key] ? (metrics as any)[REASON_OF[key]] as string | undefined : undefined;
                // 뺀 수는 숫자(외래·응급 체류) 또는 사유별 객체(재원일수)
                const exc = EXCLUDED_OF[key] ? (metrics as any)[EXCLUDED_OF[key]] as Record<string, number> | number | undefined : undefined;
                const excN = typeof exc === 'number' ? exc : exc ? Object.values(exc).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0) : 0;
                return (
                  <div key={key} className="text-center bg-white/5 rounded-xl py-3">
                    <p className="text-2xl font-bold">
                      {/* 🔴 표본 부재(null)를 '-'(진짜 0) 로 말하지 않는다 — 산출 불가라고 적는다 */}
                      {value == null
                        ? <span className="text-base font-semibold text-slate-400"><T k="산출 불가" /></span>
                        : typeof value === 'number' ? value.toLocaleString() : value}
                      {value != null && meta.unit && <span className="text-sm font-medium text-slate-300 ml-0.5"><T k={meta.unit} /></span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5"><T k={meta.label} /></p>
                    {value == null && reason ? (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        <T k={REASON_TEXT[reason] ?? reason} />
                        {/* 표본 0 이라 산출 불가인 것 — 뺀 수는 아래 각주가 말한다("대상 0건"으로 모집단을 지우지 않는다) */}
                        {typeof sampleN === 'number' && sampleN > 0 && <> · <Tf k="대상 {수}건" params={{ 수: sampleN.toLocaleString() }} /></>}
                      </p>
                    ) : typeof sampleN === 'number' && (
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {POPULATION_OF[key] && <><T k={POPULATION_OF[key]} /> · </>}
                        {sampleN > 0 ? <Tf k="표본 {수}건 기준" params={{ 수: sampleN.toLocaleString() }} /> : <T k="표본 없음" />}
                      </p>
                    )}
                    {excN > 0 && (
                      <p className="text-[10px] text-amber-300 mt-0.5" data-metric-excluded={key}>
                        <Tf k={EXCLUDED_TEXT[key] ?? '{수}건 제외'} params={{ 수: excN.toLocaleString() }} />
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="text-xs text-slate-400"><T k="지표 데이터 없음" /></p>
        )}
      </div>

      {/* 타임라인 — 🔴 (2026-10-01) 직원 환자 차트의 여정 탭과 **같은 부품**을 쓴다. 종전엔 이 화면이 자기 표(어휘에 없는 유형 10개)로
          따로 그려 실제 유형 칩이 `RECEPTION_CHECKIN` 같은 코드로 보였다(같은 사실에 표시 정본이 둘). 기간 보고서도 함께 온다. */}
      {selectedPatientId && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-gray-900"><Tf k="{환자} 여정" params={{ 환자: selectedPatientName }} /></h2>
          <JourneyTab patientId={selectedPatientId} />
        </div>
      )}

      {!selectedPatientId && (
        <div className="bg-white border rounded-2xl p-8">
          <EmptyState icon="🗺️" title="환자를 선택하면 여정 타임라인이 표시됩니다" />
        </div>
      )}
    </div>
  );
}
