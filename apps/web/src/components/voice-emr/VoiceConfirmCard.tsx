/**
 * VoiceEMR — 확인(read-back) 카드.
 *
 * 🔴 모든 write/order 카드에 **환자 신원 고정(G3)** + 명시 확정만 실행(P-1/P-6).
 * T3 오더는 n-best 라디오(단일 자동선택 금지)·고위험 2단 확인.
 *
 * 🔴 2026-08-27 — 이 파일이 고친 것 셋(전부 실제로 열려 있던 결함):
 *   ① `card.nbest.map(...)` — BE 는 `{ candidates, preSelect }` **객체**를 보낸다.
 *      배열로 읽어 **처방·검사 음성 오더의 확인 카드가 렌더 시 죽었다.**
 *      (파일 머리말이 "미배선"이라 적혀 있었지만 `VoiceEmrLauncher` 가 이미 배선했다.)
 *   ② 고위험을 `highAlert` 불리언 하나로만 그렸다 — BE 는 판정 출처를 3상태로 준다.
 *      🔴 `UNSCREENED`(마스터에도 선별어에도 없다)를 아무 표시 없이 그리면 **확인하지 못한 것을
 *      "고위험 아님"으로 말하는 것**이다. 근거 없이 안심시키지 않는다(P17).
 *   ③ 재확인 체크가 `useState` 로만 있어 확정 버튼을 막기만 하고 **아무 데도 남지 않았다**(가짜 게이트).
 *      카드에 담아 확정 시 `slots` 로 서버 `VoiceCommandLog` 에 저장되게 한다.
 *
 * 🔴 2026-09-22 — 구술(dictate)도 이 카드를 지난다. 종전엔 런처가 dictate outcome 을 받는 즉시 **확인 없이**
 *    `onApplySoap('subjective', text)` 를 불렀고, 진료 화면은 그것을 S 에 **덮어썼다**(기획서
 *    voice-emr-ambient-conversation §13.2 P0-1). 이제 환자 신원 고정(G3) 아래 **필드(S/O/A/P)를 사람이 고르고**
 *    본문을 고친 뒤 확정해야 하며, 반영은 append 정본(`appendSoap`) 하나로 간다.
 *
 * 설계: voice-emr-pipeline-design.md §3
 */
'use client';
import type { ConfirmCard, PatientRef, HighAlertSource, SoapField } from './types';
import { T, useTAttr } from '@/components/ui/i18n-text';

/** 구술 대상 필드 라벨 — `ScribeDraftPanel` FIELD_LABEL 과 같은 어휘(정본이 둘이 되지 않게 글자를 맞춘다) */
const DICTATE_FIELDS: ReadonlyArray<{ field: SoapField; label: string }> = [
  { field: 'subjective', label: 'S 주관' },
  { field: 'objective', label: 'O 객관' },
  { field: 'assessment', label: 'A 평가' },
  { field: 'plan', label: 'P 계획' },
];

function PatientHeader({ patient, badge }: { patient: PatientRef; badge?: { text: string; tone: 'danger' | 'warn' } }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
      <div className="text-sm font-bold text-gray-900">
        {patient.name} <span className="text-gray-400 font-normal">· MRN {patient.mrn}{patient.sexAge ? ` · ${patient.sexAge}` : ''}</span>
      </div>
      {badge && (
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${badge.tone === 'danger' ? 'text-rose-600 bg-rose-50' : 'text-amber-700 bg-amber-50'}`}>
          <T k={badge.text} />
        </span>
      )}
    </div>
  );
}

/**
 * 고위험 판정을 **출처와 함께** 말한다.
 * 🔴 `MASTER` + 표식 없음만이 "고위험 표식 없음"이라 말할 수 있는 유일한 상태다.
 *    `UNSCREENED` 는 미확인이고, 그 사실을 지운 채 조용히 넘어가지 않는다.
 */
function highAlertView(highAlert: boolean, source: HighAlertSource | undefined) {
  if (highAlert) return { badge: { text: '⚠ 고위험', tone: 'danger' as const }, needAck: true };
  if (source === 'MASTER') return { badge: undefined, needAck: false };
  // source 미상(구버전 payload)도 단정하지 않는다 — 확인하지 못한 것으로 말한다.
  return { badge: { text: '고위험 여부 미확인', tone: 'warn' as const }, needAck: false };
}

export interface VoiceConfirmCardProps {
  card: ConfirmCard;
  onSelect: (code: string, labIndex?: number) => void;
  onAckHighAlert: (ack: boolean) => void; // 카드에 담아 서버 slots 로 남긴다(가짜 게이트 금지)
  /** 구술 카드 — 반영 필드 선택·본문 편집(카드에 담긴다 → 확정 시 slots 로 서버 로그) */
  onDictateField?: (field: SoapField) => void;
  onDictateText?: (text: string) => void;
  onConfirm: () => void;   // 명시 확정
  onCancel: () => void;
}

export function VoiceConfirmCard({ card, onSelect, onAckHighAlert, onDictateField, onDictateText, onConfirm, onCancel }: VoiceConfirmCardProps) {
  const tAttr = useTAttr();
  const rx = card.kind === 'order-rx' ? card : null;
  const view = rx ? highAlertView(rx.highAlert, rx.highAlertSource) : { badge: undefined, needAck: false };
  const ack = !!rx?.highAlertAck;
  const needAck = view.needAck && !ack;
  const dictate = card.kind === 'dictate' ? card : null;
  // 🔴 구술은 필드를 사람이 고르기 전엔 확정할 수 없다(기본값으로 S 를 고르지 않는다 — 쓰기 폼 초기값은 미선택).
  //    본문을 전부 지웠으면 반영할 것이 없다 — 그것도 막는다.
  const dictateBlocked = !!dictate && (!dictate.field || !(dictate.editedText ?? dictate.text).trim());

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[min(560px,92vw)] rounded-2xl border border-gray-200 bg-white shadow-xl p-4">
      <PatientHeader patient={card.patient} badge={view.badge} />

      {card.kind === 'vital' && (
        <div className="text-sm">
          <div className="font-semibold text-gray-800">{card.metric}</div>
          <div className={`mt-1 text-lg font-bold ${card.abnormal ? 'text-rose-600' : 'text-gray-900'}`}>
            {card.values.join(' / ')} {card.unit ?? ''}{card.abnormal && <span className="ml-2 text-xs"><T k="(참고범위 이탈)" /></span>}
          </div>
        </div>
      )}

      {rx && (
        <div className="text-sm space-y-2">
          <div className="text-gray-500 text-xs"><T k="약품 (후보 선택)" /></div>
          {rx.nbest.candidates.length === 0 && (
            <div className="text-xs text-gray-500">
              구술 “{rx.term ?? ''}” 에 맞는 약품 마스터 후보를 찾지 못했습니다 — 처방 입력에서 직접 선택하세요.
            </div>
          )}
          {rx.nbest.candidates.map((c) => (
            <label key={c.code} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="rx" checked={rx.selectedCode === c.code} onChange={() => onSelect(c.code)} />
              <span className="text-gray-800">{c.name}</span>
              <span className="text-xs text-gray-300 ml-auto">{c.score.toFixed(2)}</span>
            </label>
          ))}
          <div className="text-gray-700 pt-1">
            {rx.dose ?? '?'}{rx.unit ?? ''} {rx.freq ? `· ${rx.freq}` : ''}{rx.route ? ` · ${rx.route}` : ''}
          </div>

          {/* 판정 사유는 서버가 준 문장을 그대로 — 화면이 근거를 지어내지 않는다 */}
          {rx.highAlertReason && (
            <div className={`text-xs rounded px-2 py-1.5 ${rx.highAlert ? 'text-rose-700 bg-rose-50' : view.badge ? 'text-amber-800 bg-amber-50' : 'text-gray-500 bg-gray-50'}`}>
              {rx.highAlertReason}
              {rx.doubleCheckRequired === null && <> <T k="(독립 이중확인 대상 여부도 판정하지 못했습니다.)" /></>}
            </div>
          )}

          {rx.doubleCheckRequired === true && (
            <div className="text-xs font-semibold text-rose-700"><T k="독립 이중확인(2인) 대상입니다 — 투약 전 확인하세요." /></div>
          )}

          {view.needAck && (
            <label className="flex items-center gap-2 text-xs text-rose-700 pt-1">
              <input type="checkbox" checked={ack} onChange={(e) => onAckHighAlert(e.target.checked)} />
              <T k="고위험 약물 — 재확인했습니다" />
            </label>
          )}
        </div>
      )}

      {card.kind === 'order-lab' && (
        <div className="text-sm space-y-1">
          <div className="text-gray-500 text-xs"><T k="검사" /></div>
          {card.labs.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-gray-800">{l.term}</span>
              {l.nbest.candidates.length > 1 && (
                <select className="text-xs border rounded px-1 ml-auto" value={l.selectedCode ?? ''} onChange={(e) => onSelect(e.target.value, i)}>
                  <option value="">{tAttr('후보 선택')}</option>
                  {l.nbest.candidates.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      )}

      {card.kind === 'order-imaging' && (
        <div className="text-sm text-gray-800">{card.bodyPart ?? ''} {card.modality}</div>
      )}

      {card.kind === 'alias' && (
        <div className="text-sm text-gray-800">{card.label} <span className="text-xs text-gray-400"><T k="(초안 삽입 — 확정은 사람)" /></span></div>
      )}

      {dictate && (
        <div className="text-sm space-y-2">
          <div className="text-gray-500 text-xs"><T k="구술" /> <span className="text-gray-400">· <T k="확정 시 선택한 필드 끝에 덧붙입니다(덮어쓰지 않음)" /></span></div>
          {/* 반영 필드 — 🔴 초기값 미선택. 라디오 이름은 rx 후보(name="rx")와 겹치지 않게 */}
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={tAttr('반영할 필드를 선택하세요')}>
            {DICTATE_FIELDS.map((f) => (
              <label key={f.field} className="flex items-center gap-1.5 cursor-pointer text-gray-800">
                <input type="radio" name="dictate-field" checked={dictate.field === f.field} onChange={() => onDictateField?.(f.field)} />
                <T k={f.label} />
              </label>
            ))}
          </div>
          {!dictate.field && <div className="text-xs text-amber-700"><T k="반영할 필드를 선택하세요" /></div>}
          {/* 본문 편집 — 인식 원문이 기본값. 고친 내용은 카드에 담겨 확정 시 함께 로그된다 */}
          <textarea
            value={dictate.editedText ?? dictate.text}
            onChange={(e) => onDictateText?.(e.target.value)}
            rows={3}
            aria-label={tAttr('구술 내용')}
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onConfirm} disabled={needAck || dictateBlocked}
          className="flex-1 text-sm font-semibold px-3 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40">
          <T k="확정 → 초안" />
        </button>
        <button type="button" onClick={onCancel} className="text-sm px-3 py-2 rounded-xl border text-gray-600 hover:bg-gray-50"><T k="취소" /></button>
      </div>
    </div>
  );
}
