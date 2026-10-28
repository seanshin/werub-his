'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface RecItem { type: string; name: string; code?: string; medicationCodeId?: string; procedureCodeId?: string; dosage?: string; frequency?: string; duration?: number; route?: string; certType?: string }
interface RecOrderSet {
  id: string;
  name: string;
  code?: string;
  diagnosisCode?: string;
  items: RecItem[];
  ageGroup?: string;
  contraindications?: Array<{ note?: string }>;
  matchScore?: number;   // 추천 엔진 v2 — 주상병 가중·prefix·useCount 반영 점수
  matchedBy?: string;    // EXACT | PREFIX | LEGACY_EXACT
  matchedCode?: string;  // 매칭된 진단코드
  /** 🔴 금기가 저장돼 있는데 전부 note 형이라 자동 대조가 한 건도 평가되지 못한 세트(2026-09-03) */
  contraUnevaluated?: boolean;
}

/**
 * 진단 기반 추천 약속처방 (G1-5) — 확정 진단코드(KCD)로 매칭되는 오더세트를 배너로 노출.
 * 적용은 공용 handleApplyOrderSet 재사용(실 처방 생성·/use·경고 동일).
 */
export function RecommendedOrderSets({
  diagnosisCodes,
  primaryCode,
  age,
  patientId,
  onApply,
}: {
  diagnosisCodes: string[];
  primaryCode?: string; // 주상병 코드 — 추천 가중(×1.5)·PRIMARY_ONLY 매핑 활성
  age?: number | null;  // 환자 나이 — ageGroup 부적합 세트 제외
  patientId?: string;   // 환자 ID — ALLERGY형 금기 대조(활성 알레르기 원장)로 금기 세트 제외
  onApply: (items: RecItem[], orderSetId?: string, meta?: { name?: string; ageGroup?: string; contraindications?: Array<{ note?: string }> }) => void | Promise<void>;
}) {
  const tAttr = useTAttr();
  const codes = Array.from(new Set(diagnosisCodes.filter(Boolean)));
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['orderset-recommend', codes.join(','), primaryCode ?? '', age ?? '', patientId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: RecOrderSet[] }>(
          `/api/v1/order-sets/recommend?diagnosisCodes=${encodeURIComponent(codes.join(','))}`
          + (primaryCode ? `&primaryCode=${encodeURIComponent(primaryCode)}` : '')
          + (age != null ? `&age=${age}` : '')
          + (patientId ? `&patientId=${encodeURIComponent(patientId)}` : ''),
        ),
    enabled: codes.length > 0,
  });
  const raw = data?.data;
  const sets: RecOrderSet[] = Array.isArray(raw) ? raw : ((raw as Record<string, unknown> | undefined)?.data as RecOrderSet[]) ?? [];

  // 🔴 추천 조회 실패로 패널이 사라지면 "추천 없음"으로 읽힌다 — 못 읽었다고 말한다
  if (codes.length > 0 && isError) {
    return (
      <div className="mt-3">
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      </div>
    );
  }
  if (!codes.length || sets.length === 0) return null;

  return (
    <div className="mt-3 p-3 border border-indigo-200 bg-indigo-50 rounded-xl">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm font-semibold text-indigo-800"><T k="💡 추천 약속처방" /></span>
        <span className="text-[10px] text-indigo-400">진단코드({codes.join(', ')}) 기반</span>
      </div>
      <div className="space-y-1.5">
        {sets.map((os) => (
          <div key={os.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs font-medium text-gray-800">{os.name}</span>
              {os.matchedCode && primaryCode === os.matchedCode && (
                <span className="ml-1.5 text-[9px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded" title={`주상병(${os.matchedCode}) 매칭 — 가중 추천`}><T k="주상병" /></span>
              )}
              {os.matchedBy === 'PREFIX' && (
                <span className="ml-1 text-[9px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded" title={tAttr("상위분류(prefix) 매칭")}><T k="유사" /></span>
              )}
              {/* 🔴 금기 자동 대조가 안 된 세트를 "대조 통과"처럼 보이게 하지 않는다 — 사람이 메모를 읽어야 한다 */}
              {os.contraUnevaluated && (
                <span className="ml-1 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title="저장된 금기가 전부 메모(자유 텍스트)라 자동 대조가 평가되지 않았습니다 — 적용 전 검토 창의 금기 메모를 확인하세요">금기 수동확인</span>
              )}
              <span className="text-[10px] text-gray-400 ml-2">{os.items?.length ?? 0}항목{os.ageGroup && os.ageGroup !== 'ALL' ? ` · ${({ ADULT: '성인', PEDIATRIC: '소아', GERIATRIC: '노인' } as Record<string, string>)[os.ageGroup] ?? os.ageGroup}` : ''}{os.matchScore != null ? ` · 적합도 ${os.matchScore}` : ''}</span>
            </div>
            <button
              type="button"
              onClick={() => onApply(os.items ?? [], os.id, { name: os.name, ageGroup: os.ageGroup, contraindications: os.contraindications })}
              className="px-2.5 py-1 text-[11px] font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shrink-0"
            >
              <T k="적용" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
