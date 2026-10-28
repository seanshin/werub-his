'use client';

import { useState } from 'react';

/**
 * 생체정보(음성 성문) 처리 동의 — 개인정보보호법 §23(민감정보) 별도 명시 동의.
 * 필수 2개 체크 후에만 동의 활성. 거부해도 마이크 분리 방식으로 음성 기능 이용 가능(불이익 없음).
 */
export function BiometricConsentModal({ version, onAgree, onClose }: { version: string; onAgree: () => void; onClose: () => void }) {
  const [c1, setC1] = useState(false); // 생체정보 수집·이용
  const [c2, setC2] = useState(false); // 처리 위탁(AI 서버)
  const ready = c1 && c2;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-base font-bold text-gray-900">음성 생체정보(성문) 처리 동의</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-4 text-sm text-gray-700 space-y-3">
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-800">
            음성 성문(voiceprint)은 <b>개인정보보호법상 민감정보(생체인식정보)</b>입니다. 아래 내용을 확인하고 동의 여부를 선택하십시오.
            <b> 동의하지 않아도</b> 마이크 분리(헤드셋/지향성 마이크) 방식으로 음성 기능을 그대로 이용할 수 있으며 어떠한 불이익도 없습니다.
          </p>

          <Section title="1. 수집·이용하는 항목">
            음성 발화 표본 및 이로부터 생성되는 <b>성문 특징값(voiceprint embedding)</b>. 원음(raw audio)은 임베딩 생성 후 서버에 보관하지 않습니다.
          </Section>
          <Section title="2. 수집·이용 목적">
            의료진 본인(화자)의 식별 및 음성 EMR 인식 정확도 향상. 다인 환경에서 본인 음성만 선별하기 위한 용도로만 사용합니다.
          </Section>
          <Section title="3. 처리 위탁">
            성문 임베딩의 생성·보관은 <b>원내 AI 서버(WeRU.B, example.org)</b>에 위탁하여 처리됩니다. 위탁 범위를 벗어난 이용은 없습니다.
          </Section>
          <Section title="4. 보유·이용 기간 및 파기">
            등록 유지 기간(철회 또는 퇴직·권한 종료 시)까지 보유하며, <b>철회 즉시 성문·표본·동의기록을 지체 없이 파기</b>합니다.
          </Section>
          <Section title="5. 동의 거부 권리 및 철회권">
            동의를 거부할 권리가 있으며, 거부 시 마이크 분리 방식으로 이용됩니다(불이익 없음). 등록 후에도 <b>언제든지 설정에서 철회·삭제</b>할 수 있습니다.
          </Section>

          <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={c1} onChange={(e) => setC1(e.target.checked)} className="mt-0.5" />
            <span className="text-[13px]"><b className="text-rose-600">[필수]</b> 위 음성 생체정보(성문)의 수집·이용에 동의합니다.</span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={c2} onChange={(e) => setC2(e.target.checked)} className="mt-0.5" />
            <span className="text-[13px]"><b className="text-rose-600">[필수]</b> 성문 임베딩의 원내 AI 서버(WeRU.B) 처리 위탁에 동의합니다.</span>
          </label>
          <p className="text-[11px] text-gray-400">동의 버전: {version}</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-full border px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button type="button" disabled={!ready} onClick={onAgree}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold text-white ${ready ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300 cursor-not-allowed'}`}>
            동의하고 등록 시작
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-gray-900 text-[13px]">{title}</p>
      <p className="text-[13px] text-gray-600 leading-relaxed">{children}</p>
    </div>
  );
}
