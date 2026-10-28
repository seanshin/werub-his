'use client';

import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { decideProposal, type AiProposalDecision } from '@/lib/ai-proposal';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';

/**
 * 초안 ≠ 확정 — AI 초안이 폼에 들어간 뒤에도 그 사실이 보이게 하는 정본 배너(§7.6·§7.6-b).
 *
 * 🔴 2026-08-19 실측: 패널 안에서는 "AI 제안"으로 구분되던 글이 **적용 버튼을 누르는 순간 사람이 쓴 글자와 같아졌다**
 *    (진료 AI 보조·스크라이브·앰비언트·퇴원요약·VoC 답변). 퇴원요약은 저장 후 화면이 `작성: {의사명}` 이라 말한다.
 *    자동 저장을 자동 서명으로 읽히게 만들지 않는다 — 서명 전까지 "초안에서 출발했고 아직 확정이 아니다"를 화면이 말한다.
 *
 * 프로비넌스: 스키마 필드가 있는 자원(간호기록 aiAssisted·앰비언트 Encounter.aiScribed·VoC aiDraft)은 그 필드로,
 * 없는 자원(진료 AI 보조·퇴원요약)은 `recordDraftApplied()` 로 **감사 원장**에 남긴다(`POST /api/v1/ai/draft-applied`).
 * 배너는 `recorded` 가 참일 때만 "감사기록에 남았습니다"라고 말한다 — 기록 실패를 성공처럼 말하지 않는다.
 */
// 🔴 서버 `medical-ai.dto.ts` `AI_DRAFT_SOURCES` 와 집합 일치(가드 `test/ui/voice-dictate-append-canon.spec.ts`) —
//    FE 에만 더하면 `/ai/draft-applied` 가 400 을 내고 배너는 "감사기록에 남기지 못했습니다"를 그린다.
export type DraftSource = 'ASSISTANT' | 'REASONING' | 'AUTO_RECORD' | 'SCRIBE' | 'AMBIENT' | 'GENERATOR' | 'DICTATE';
export type DraftResourceType = 'ENCOUNTER_SOAP' | 'DISCHARGE_SUMMARY' | 'REFERRAL' | 'CONSENT' | 'VOC_REPLY' | 'CHECKUP_OPINION' | 'MDT_SUMMARY' | 'OTHER';

const SOURCE_LABEL: Record<DraftSource, string> = {
  ASSISTANT: '진료 보조 초안',
  REASONING: '추론 초안',
  AUTO_RECORD: '자동 기록 초안',
  SCRIBE: '음성 스크라이브 초안',
  AMBIENT: '앰비언트 대화 초안',
  GENERATOR: '자동 생성 초안',
  DICTATE: '음성 구술 초안',
};

export interface DraftProvenance {
  source: DraftSource;
  /** 적용된 필드(들) — 사람이 읽는 라벨 */
  fields: string[];
  appliedAt: string; // ISO
  model?: string | null;
  /** 감사 원장 기록 여부 — null=미시도(스키마 필드로 남는 자원), true/false=시도 결과 */
  recorded: boolean | null;
  /** P1: 서버 AiProposal id — 있으면 결정(수락/수정/거부)이 제안 원장에 남는다 */
  proposalId?: string | null;
}

/** 감사 원장에 프로비넌스 기록 — 실패해도 업무를 막지 않는다(반환값으로만 말한다) */
export async function recordDraftApplied(input: {
  resourceType: DraftResourceType;
  source: DraftSource;
  patientId?: string | null;
  resourceId?: string | null;
  field?: string;
  model?: string | null;
  promptVersion?: string | null;
  textLength: number;
  /** P1: 제안 id 가 있으면 제안 원장에 결정을 남긴다(기본 ACCEPTED · finalText 가 있으면 편집거리 계산) */
  proposalId?: string | null;
  decision?: AiProposalDecision;
  finalText?: string;
  clientContext?: string;
}): Promise<boolean> {
  // P1 제안 원장 — 감사 원장(레거시)과 함께 남긴다. 둘 중 하나라도 실패하면 false(성공처럼 말하지 않는다).
  let proposalOk: boolean | null = null;
  if (input.proposalId) {
    const d = await decideProposal(input.proposalId, {
      decision: input.decision ?? 'ACCEPTED',
      ...(input.finalText != null ? { finalText: input.finalText } : {}),
      ...(input.clientContext ? { clientContext: input.clientContext } : {}),
    });
    proposalOk = d.ok;
  }
  try {
    const r = await apiClient.post<{ data?: { recorded?: boolean } }>('/api/v1/ai/draft-applied', {
      resourceType: input.resourceType,
      source: input.source,
      ...(input.patientId ? { patientId: input.patientId } : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.field ? { field: input.field } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.promptVersion ? { promptVersion: input.promptVersion } : {}),
      textLength: input.textLength,
    });
    const legacyOk = !!r?.data?.recorded;
    return proposalOk == null ? legacyOk : legacyOk && proposalOk;
  } catch {
    return false;
  }
}

/** 초안 배너의 기록 실패 문장 — 배너와 결정 시점 경고가 같은 사실을 같은 문장으로 말한다 */
export const DRAFT_NOT_RECORDED_TEXT = '⚠️ 적용 사실을 감사기록에 남기지 못했습니다(서버 미응답) — 이 기록이 AI 초안에서 출발했음을 기록에 직접 남기세요.';

/**
 * 🔴 (2026-09-15 T2) **결정 시점**(협진 의뢰 전송·MDT 요약 저장·동의서 생성) 기록 실패를 보이게 한다.
 *    그 자리들은 `await recordDraftApplied(...)` 의 반환값을 버리고 곧바로 폼·배너를 지웠다 — 배너가 사라지니
 *    `recorded === false` 경고를 그릴 곳도 없어 "AI 초안에서 출발한 기록"이 원장에서 조용히 빠졌다(AI기본법 표기 추적).
 *    업무는 막지 않는다(비차단 경고) · 성공이면 아무 말도 하지 않는다.
 *    배너가 계속 떠 있는 자리(초안 적용 시점)는 배너가 `recorded` 로 이미 말하므로 이 헬퍼를 쓰지 않는다.
 */
export function warnIfDraftNotRecorded(recorded: boolean, translate: (k: string) => string): boolean {
  if (!recorded) toast.warning(translate(DRAFT_NOT_RECORDED_TEXT));
  return recorded;
}

export function DraftBanner({ provenance, onDismiss, signLabel = '서명', className = '' }: {
  provenance: DraftProvenance | null | undefined;
  /** 사람이 "검토했다"고 배너를 접을 수 있게 — 접어도 프로비넌스는 지워지지 않는다(표시만) */
  onDismiss?: () => void;
  /** 이 자원의 확정 행위 이름(서명·발송·저장 확정 등) */
  signLabel?: string;
  className?: string;
}) {
  const tAttr = useTAttr();
  /**
   * 🔴 `서명` 은 카탈로그에 **'Signed'(과거분사)** 로 등재돼 있다 — 동사 자리에 그대로 쓰면
   *    "then Signed" 가 된다. 기본 라벨일 때만 동작형 문맥 키로 갈아탄다(ko 는 `@문맥` 을 벗겨
   *    렌더하므로 한국어 화면은 글자 하나도 바뀌지 않는다). 호출자가 다른 라벨을 주면 그대로 옮긴다.
   */
  const signWord = signLabel === '서명' ? tAttr('서명@동작') : tAttr(signLabel);
  const modelWord = tAttr('모델');
  if (!provenance) return null;
  const when = new Date(provenance.appliedAt);
  const hhmm = Number.isNaN(when.getTime()) ? '' : `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  return (
    <div
      role="status"
      data-draft-banner={provenance.source}
      className={`flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2 ${className}`}
    >
      <span aria-hidden="true" className="mt-0.5 text-violet-600">✦</span>
      <div className="flex-1 min-w-0 text-xs text-violet-900">
        <p className="font-semibold">
          {AI_ORIGIN_TEXT} <T k={SOURCE_LABEL[provenance.source]} /> <T k="적용됨 —" />{' '}
          <Tf className="text-rose-700" k="{서명} 전 · 확정 아님" params={{ 서명: signWord }} />
        </p>
        <p className="mt-0.5 text-[11px] text-violet-800">
          {/* 🔴 공백을 자리표시자 밖에 두려면 항목·시각 유무로 키를 가른다(언어마다 구두점이 다르다) */}
          <Tf
            k={
              provenance.fields.length
                ? hhmm
                  ? '{항목} 에 {시각} 반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.'
                  : '{항목} 에 반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.'
                : hhmm
                  ? '{시각} 반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.'
                  : '반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.'
            }
            params={{ 항목: provenance.fields.join('·'), 시각: hhmm, 서명: signWord }}
          />
          {provenance.model ? ` · ${modelWord} ${provenance.model}` : ''}
        </p>
        <p className="mt-0.5 text-[11px] text-violet-700">
          {provenance.recorded === true && <T k="적용 사실이 감사기록에 남았습니다." />}
          {provenance.recorded === false && <T k="⚠️ 적용 사실을 감사기록에 남기지 못했습니다(서버 미응답) — 이 기록이 AI 초안에서 출발했음을 기록에 직접 남기세요." />}
          {provenance.recorded === null && <T k="적용 사실은 이 기록의 AI 보조 표식으로 남습니다." />}
        </p>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-[11px] text-violet-700 underline hover:text-violet-900" title={tAttr('배너만 접습니다 — 프로비넌스는 유지됩니다')}>
          <T k="검토함" />
        </button>
      )}
    </div>
  );
}
