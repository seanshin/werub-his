'use client';

/**
 * 재원 환자 AI 위험 배지(재입원·합병증·부작용) — 입원 목록 행에서 분리(2026-10-07 · 테스트 가능하게).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { apiClient, ApiError } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface AiRiskData {
  risk_level?: string;
  score?: number;
  factors?: string[];
  /** 재입원 — 기록에서 채우지 못한 점수 항목(서버 판정 · 빠진 항목은 0점이라 위험도가 낮게 나올 수 있다) */
  inputGaps?: string[];
}

/** 재입원 점수 항목 라벨 — 서버 `ReadmissionInputGap` 어휘 */
const GAP_LABEL: Record<string, string> = {
  HB: 'Hb', NA: 'Na', ADMISSION_ROUTE: '입원 경로', PROCEDURE: '입원 중 시술', ONCOLOGY: '종양내과 퇴원', PAST_ADMISSIONS: '1년 내 입원', LENGTH_OF_STAY: '재원일수',
};

export function AiRiskBadges({ admissionId, patientAge, patientSex, diagnoses, lengthOfStay, medications }: {
  admissionId: string; patientAge?: number; patientSex?: string; diagnoses?: string[]; lengthOfStay?: number; medications?: string[];
}) {
  // 2026-07-07 검토 교정:
  //  - 실데이터 없으면 예측하지 않음(종전 age 65·남성 날조 기본값 폐지 — 임상 무의미)
  //  - DTO 정합: complication은 diagnosis(단수 문자열)·adverse-drug은 drugs — 종전 diagnoses/medications 전송으로 상시 400('-')
  //  - 실패는 '점검 불가'(?)로 표기 — 실패가 무위험처럼 읽히지 않게(안전 정보의 실패≠정상 원칙)
  const tAttr = useTAttr();
  const hasDemo = patientAge != null && !!patientSex;
  const primaryDx = diagnoses?.[0];

  /**
   * 🔴 (2026-10-07) **목록이 열릴 때 자동으로 부르지 않는다 — 누를 때만, 차례로.**
   *    종전엔 재원 환자 행마다 재입원·합병증 예측을 화면이 열리자마자 동시에 보냈다(행 수 × 2).
   *    AI 서버는 같은 키의 의료 생성 요청을 **1건씩** 처리하고 나머지는 60초까지 대기시킨 뒤 거절한다
   *   . 한 환자의 여러 예측도 차례로 보내라는 것이 통지 권장이다.
   *    → 행의 'AI 위험' 을 누른 환자만 · 재입원 → 합병증 → 부작용 순서로 하나씩.
   */
  const [requested, setRequested] = useState(false);
  const canReadmit = hasDemo;
  const canComplication = hasDemo && !!primaryDx;
  const canAdverse = !!medications?.length;
  const risk = useQuery({
    queryKey: ['ai-risk', admissionId],
    queryFn: async () => {
      const one = async (on: boolean, path: string, body: Record<string, unknown>): Promise<RiskSlot | null> => {
        if (!on) return null;
        try {
          const res = await apiClient.post<{ data: AiRiskData }>(path, body);
          return { data: res?.data, failed: false, busy: false };
        } catch (e) {
          // 바쁨(429 · AI_UPSTREAM_BUSY)은 고장이 아니라 "잠시 후 다시" — 다른 표식으로
          return { failed: true, busy: e instanceof ApiError && e.code === 'AI_UPSTREAM_BUSY' };
        }
      };
      // 🔴 재원일수를 모르면 1로 채우던 것 제거 — 입원(admissionId)을 보내 서버가 기록에서 재원일수·1년 내 입원·Hb·Na·응급 경유·입원 중 수술을 채운다
      const readmit = await one(canReadmit, '/api/v1/ai/predict/readmission', {
        age: patientAge, sex: patientSex, diagnoses: diagnoses ?? [], admissionId, ...(lengthOfStay != null ? { lengthOfStay } : {}),
      });
      const complication = await one(canComplication, '/api/v1/ai/predict/complication', { age: patientAge, sex: patientSex, diagnosis: primaryDx });
      const adverse = await one(canAdverse, '/api/v1/ai/predict/adverse-drug', {
        drugs: medications ?? [], ...(patientAge != null ? { age: patientAge } : {}), ...(patientSex ? { sex: patientSex } : {}),
      });
      return { readmit, complication, adverse };
    },
    staleTime: 24 * 60 * 60 * 1000,
    enabled: requested && !!admissionId,
    retry: false,
  });

  if (!requested && (canReadmit || canComplication || canAdverse)) {
    return (
      <button type="button" onClick={() => setRequested(true)} data-ai-risk-request={admissionId}
        className="whitespace-nowrap rounded-full border border-gray-200 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500 hover:bg-gray-50"
        title={tAttr('누르면 이 환자만 AI 위험 예측을 차례로 요청합니다')}>
        AI <T k="위험" />
      </button>
    );
  }
  const slot = (s: RiskSlot | null | undefined) => s ?? undefined;
  const r = risk.data;
  return (
    <div className="flex gap-1" data-ai-risk={admissionId}>
      <RiskBadge data={slot(r?.readmit)?.data} loading={risk.isLoading} failed={!!slot(r?.readmit)?.failed} busy={!!slot(r?.readmit)?.busy} enabled={canReadmit} prefix="재" />
      <RiskBadge data={slot(r?.complication)?.data} loading={risk.isLoading} failed={!!slot(r?.complication)?.failed} busy={!!slot(r?.complication)?.busy} enabled={canComplication} prefix="합" />
      <RiskBadge data={slot(r?.adverse)?.data} loading={risk.isLoading} failed={!!slot(r?.adverse)?.failed} busy={!!slot(r?.adverse)?.busy} enabled={canAdverse} prefix="부" />
    </div>
  );
}

interface RiskSlot { data?: AiRiskData; failed: boolean; busy: boolean }

function RiskBadge({ data, loading, failed, busy = false, enabled, prefix }: {
  data?: AiRiskData; loading: boolean; failed: boolean; busy?: boolean; enabled: boolean; prefix: string;
}) {
  const tAttr = useTAttr();
  const label = prefix === '재' ? '재입원' : prefix === '합' ? '합병증' : '부작용';
  // 🔴 입력 자료가 없으면 **예측하지 않되, 안 한다는 사실은 보여준다.**
  //    종전엔 `return null` 이라 칸이 통째로 비어 "위험 없음"으로 읽혔다 — 이 컴포넌트가 스스로 세운
  //    원칙(실패는 `?` 로 표기·"실패가 무위험처럼 읽히지 않게")이 **자료 부족에는 적용되지 않았다**.
  if (!enabled) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-300 whitespace-nowrap"
        title={`${label} 위험: 예측에 필요한 자료가 없습니다(나이·성별·진단·투약 미기록) — 위험이 없다는 뜻이 아닙니다`}>
        {prefix}–
      </span>
    );
  }
  if (loading) return <span className="text-[9px] text-gray-300 w-6 text-center">...</span>;
  const level = data?.risk_level;
  if (busy) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 whitespace-nowrap" data-ai-risk-busy
        title={`${label} 위험: AI 서버가 바빠 이번에는 받지 못했습니다(동시 처리 한도) — 잠시 후 화면을 다시 열어 요청하세요`}>
        {prefix}⏳
      </span>
    );
  }
  if (failed || !level) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap"
        title={`${label} 위험: 점검 불가(${AI_ORIGIN_TEXT} 응답 없음)`}>
        {prefix}?
      </span>
    );
  }

  const color: Record<string, string> = {
    HIGH: 'bg-red-100 text-red-700',
    MODERATE: 'bg-amber-100 text-amber-700',
    LOW: 'bg-green-100 text-green-700',
  };
  const icon: Record<string, string> = { HIGH: '!', MODERATE: '~', LOW: '' };

  // 🔴 AI 서버 회신(10-07): 빠진 점수 항목은 0점 — 특히 LOW 는 "기록이 없어 낮게 나왔을 수 있다"를 같이 말한다
  const gaps = (data?.inputGaps ?? []).map((g) => tAttr(GAP_LABEL[g] ?? g));
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${color[level] ?? 'bg-gray-100 text-gray-500'}`}
      title={gaps.length ? `${label} 위험: ${level} — ${tAttr('빠진 점수 항목(0점 처리 · 위험도가 낮게 나올 수 있음)')}: ${gaps.join(', ')}` : `${label} 위험: ${level}`}>
      {prefix}{icon[level]}
      {gaps.length > 0 && <sup className="ml-0.5 text-amber-700" data-ai-risk-gaps={gaps.length}>*</sup>}
    </span>
  );
}

