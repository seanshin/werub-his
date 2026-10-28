'use client';

import Link from 'next/link';
import { RECORDING_CONSENT_DRAFT } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

/**
 * 녹음 시작 전 **확인** 팝업(모달) — 동의서를 만들지도, 검증하지도 않는다.
 *
 * 🔴 실제 게이트는 서버다: `ambient.service requireRecordingConsent` / `scribe.service` 가
 *    `ConsentForm(consentType=RECORDING, isValid=true)` 행을 요구하고, 없으면 400 `RECORDING_CONSENT_REQUIRED`.
 *    동의서 접수(전자동의서)는 consent 모듈 정본 — 동의서 워크스테이션(`/workstation/consent`)에서 RECORDING 유형으로.
 * 🔴 가짜 게이트 금지(CLAUDE.md §4): 종전엔 로컬 체크박스가 버튼을 막았는데 그 체크는 어디에도 남지 않았다.
 *    남길 곳이 없으면 막지도 않는다 — 체크박스를 없애고, 이 확인이 기록되지 않는다는 사실을 화면이 말한다.
 * 🔴 문안 정직화(2026-09-22 · voice-emr §13.4 D4): 종전 "원음은 전사 후 파기하며 외부로 제공되지 않습니다" 는
 *    AI 서버 주소가 설정값(`ai.server.url`)이라 설치 형태에 따라 거짓이 된다. 설치가 실제로 하는 일만 말한다.
 *    (가드: web `consent-type-list-canon.spec.ts` 가 금지 단정·체크박스 차단의 재유입을 본다)
 */
export default function RecordingConsentGate({ onConsent, onClose }: { onConsent: () => void; onClose?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-[min(460px,92vw)] rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm shadow-xl dark:border-amber-700 dark:bg-amber-950/90"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between">
          <p className="font-semibold text-amber-900 dark:text-amber-200"><T k="진료 녹음 · AI 문서화 — 시작 전 확인" /></p>
          {onClose && (
            <button type="button" onClick={onClose} className="text-amber-500 hover:text-amber-700 text-lg leading-none" aria-label="닫기">✕</button>
          )}
        </div>
        <ul className="mb-3 list-disc space-y-1 pl-4 text-amber-800 dark:text-amber-300">
          <li><T k="진료 대화를 녹음·전사하여 진료기록(SOAP) 초안 작성에 활용합니다. 최종 작성·확인·서명은 담당 의사가 합니다." /></li>
          <li><T k="전사·분석은 기관이 지정한 AI 서버(시스템 설정 ai.server.url)에서 처리됩니다. 그 서버가 원내에 있는지 원외에 있는지는 설치 형태에 따라 다르며, 이 화면은 그것을 확인하지 않습니다." /></li>
          <li><T k="원음·전사의 보존 기간은 아직 정해지지 않았습니다(기관 확정 전). 동의는 철회할 수 있으며, 거부해도 진료상 불이익이 없습니다(의사가 직접 기록)." /></li>        </ul>
        <p className="mb-2 rounded-lg border border-amber-200 bg-white/60 px-2.5 py-2 text-[12px] text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          <T k="이 확인은 어디에도 기록되지 않습니다. 실제 검증은 서버가 환자의 전자동의서(진료 녹음·AI 문서화 유형)로 하며, 동의서가 없으면 시작이 거부됩니다." />
        </p>
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <Link href="/workstation/consent" className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900">
            <T k="전자동의서 접수: 동의서 워크스테이션" />
          </Link>
          <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] text-amber-900" title={`${RECORDING_CONSENT_DRAFT.statusLabel} · ${RECORDING_CONSENT_DRAFT.draftedOn}`}>
            <T k="문안은 법무 검토 전 초안입니다" />
          </span>
        </p>
        <div className="mt-2 flex justify-end gap-2">
          {onClose && (
            <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-amber-300 px-3 py-2 text-xs text-amber-800 hover:bg-amber-100"><T k="취소" /></button>
          )}
          <button
            type="button"
            onClick={onConsent}
            className="min-h-[44px] rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
          >
            <T k="확인했습니다 — 시작" />
          </button>
        </div>
      </div>
    </div>
  );
}
