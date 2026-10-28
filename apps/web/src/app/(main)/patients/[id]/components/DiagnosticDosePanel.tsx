'use client';

/**
 * 누적 진단 피폭선량 패널 — **영상 탭에만 둔다.**
 *
 * 🔴 이 화면이 오래 없었던 이유는 "붙일 자리인 `RadiationTab` 이 방사선치료라 단위·개념이
 *    섞인다"였다. 재실측하니 전제가 틀렸다 — `radiation` 탭은 라벨부터 **'방사선종양'**
 *    (방사선종양학과·치료선량 Gy)이고, 진단 피폭(mSv)의 자리는 처음부터 **영상 탭**이다.
 *    두 개념은 단위도(Gy vs mSv) 목적도(치료 처방 vs 안전 노출 추적) 다르다. 섞지 않는다.
 *
 * 🔴 정직성 규약 — 이 패널이 반드시 지켜야 하는 것:
 *   · 기록이 없으면 `0 mSv` 가 아니라 **"산출 불가"**. 몰라서 없는 것과 재서 0인 것은 다르다.
 *   · **분모를 함께** 말한다. 누적 mSv 만 보면 "적게 쬐었다"로 읽히지만 실제로는 선량을
 *     안 적은 촬영이 대부분일 수 있다(선량 입력은 촬영 화면의 **선택** 입력이다).
 *   · 합계에 DLP×k **추정치**가 섞였으면 그 사실을 말한다.
 *   · 목록을 자르면 잘랐다고 말한다.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { Ratio, Num } from '@/components/ui/display';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

interface ExposureItem {
  id: string;
  modality: string;
  bodyPart: string | null;
  dlp: string | number | null;
  effectiveDoseMsv: string | number | null;
  estimated: boolean;
  performedAt: string;
}

interface ExposureSummary {
  totalCount: number;
  dosedCount: number;
  totalEffectiveMsv: number | null;
  totalEffectiveUnavailableReason: 'NO_RECORD' | 'NO_DOSE_VALUE' | null;
  last12moCount: number;
  last12moDosedCount: number;
  last12moEffectiveMsv: number | null;
  last12moEffectiveUnavailableReason: 'NO_RECORD' | 'NO_DOSE_VALUE' | null;
  estimatedCount: number;
  ionizingStudies: number;
  studiesWithDose: number;
  byModality: Record<string, number>;
}

interface ExposureResponse {
  items: ExposureItem[];
  itemsTruncated: boolean;
  itemLimit: number;
  summary: ExposureSummary;
}

/** 🔴 사유 어휘는 서버가 정한다 — 화면이 지어내지 않는다. */
const UNAVAILABLE_TEXT: Record<string, string> = {
  NO_RECORD: '선량 기록이 없습니다',
  NO_DOSE_VALUE: '기록은 있으나 유효선량 값이 비어 있습니다',
};

function Msv({ value, reason }: { value: number | null; reason: string | null }) {
  if (value == null) {
    return (
      <span className="text-gray-400">
        {RATIO_UNAVAILABLE}
        {reason && <span className="text-[11px] ml-1">({UNAVAILABLE_TEXT[reason] ?? reason})</span>}
      </span>
    );
  }
  // 🔴 자릿수·단위는 shared `NUMERIC_POLICIES.radiationDoseMsv` 정본이 정한다(toFixed 직접 호출 금지).
  return <span className="font-bold text-gray-900"><Num value={value} domain="radiationDoseMsv" /></span>;
}

export function DiagnosticDosePanel({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-radiation-exposure', patientId],
    queryFn: () => apiClient.get<{ data: ExposureResponse }>(`/api/v1/imaging/patients/${patientId}/radiation-exposure`),
    enabled: !!patientId,
  });

  if (isError) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3"><T k="☢ 누적 진단 피폭선량" /></h3>
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const s = data?.data?.summary;
  const items = data?.data?.items ?? [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-lg font-semibold text-gray-900"><T k="☢ 누적 진단 피폭선량" /></h3>
        <span className="text-[11px] text-gray-400 mt-1"><T k="진단영역 유효선량(mSv)" /></span>
      </div>
      {/* 🔴 개념이 섞이지 않게 화면이 먼저 말한다 */}
      <p className="text-[11px] text-gray-400 mb-4">
        방사선치료 선량(Gy)은 별도 개념입니다 — <span className="text-gray-500">방사선종양 탭</span>에서 확인하세요.
      </p>

      {isLoading ? (
        <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
      ) : !s ? (
        <p className="text-sm text-gray-400"><T k="불러오지 못했습니다." /></p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="text-[11px] text-gray-500 mb-1"><T k="최근 1년 누적" /></div>
              <div className="text-lg"><Msv value={s.last12moEffectiveMsv} reason={s.last12moEffectiveUnavailableReason} /></div>
              <div className="text-[11px] text-gray-400 mt-1">선량 기록 {s.last12moDosedCount} / 피폭 기록 {s.last12moCount}건</div>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="text-[11px] text-gray-500 mb-1"><T k="전체 누적" /></div>
              <div className="text-lg"><Msv value={s.totalEffectiveMsv} reason={s.totalEffectiveUnavailableReason} /></div>
              <div className="text-[11px] text-gray-400 mt-1">선량 기록 {s.dosedCount} / 피폭 기록 {s.totalCount}건</div>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              {/* 🔴 분모 — 이 값 없이 누적 mSv 만 보면 "적게 쬐었다"로 오독된다 */}
              <div className="text-[11px] text-gray-500 mb-1"><T k="선량이 기록된 촬영" /></div>
              <div className="text-lg font-bold text-gray-900">
                <Ratio numerator={s.studiesWithDose} denominator={s.ionizingStudies} />
              </div>
              <div className="text-[11px] text-gray-400 mt-1"><T k="시행된 전리방사선 촬영 기준" /></div>
            </div>
          </div>

          {s.estimatedCount > 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1.5 mt-3">
              누적값에 DLP×부위별 변환계수로 <b>추정한 유효선량 {s.estimatedCount}건</b>이 포함돼 있습니다(장비 콘솔 실측값이 아닙니다).
            </p>
          )}

          {s.ionizingStudies > s.studiesWithDose && (
            <p className="text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1.5 mt-2">
              전리방사선 촬영 {s.ionizingStudies - s.studiesWithDose}건은 선량이 기록되지 않았습니다 — 누적값은 <b>하한</b>입니다.
              선량 입력은 촬영 화면의 선택 입력입니다.
            </p>
          )}

          {items.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="text-[11px] text-gray-500 mb-2">
                피폭 이력
                {data?.data?.itemsTruncated && <span className="ml-1 text-amber-600">(최근 {data.data.itemLimit}건만 표시 — 전체 {s.totalCount}건)</span>}
              </div>
              <div className="space-y-1">
                {items.slice(0, 10).map((it) => (
                  <div key={it.id} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-24 shrink-0">{kdate(it.performedAt)}</span>
                    <span className="font-medium text-gray-700 w-12 shrink-0">{it.modality}</span>
                    <span className="text-gray-500 flex-1 truncate">{it.bodyPart ?? '-'}</span>
                    <span className="text-gray-800 shrink-0">
                      {it.effectiveDoseMsv == null
                        ? <span className="text-gray-400"><T k="선량 미기록" /></span>
                        : <><Num value={Number(it.effectiveDoseMsv)} domain="radiationDoseMsv" />{it.estimated && <span className="text-amber-600 ml-1">(추정)</span>}</>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
