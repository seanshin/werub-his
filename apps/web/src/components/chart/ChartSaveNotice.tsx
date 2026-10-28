'use client';

import { useState } from 'react';
import {
  chartMappingSummary, unmappedBlockHeader, SOAP_SLOT_LABEL, UNMAPPED_SLOT,
  type ChartSectionDef,
} from './chart-values';

/**
 * 차트 템플릿이 **어디에 무엇을 저장하는지** 화면이 사실대로 말한다(P16 — 하지 않는 것을 한다고 하지 않는다).
 *
 * 🔴 종전: 입력칸은 다 보여주면서 저장은 SOAP 매핑된 필드만 됐고, 나머지 41%는 아무 말 없이 사라졌다.
 * 지금: 매핑 없는 항목은 객관적 소견(O)의 `[차트: … · SOAP 미지정]` 블록에 라벨과 함께 저장되고,
 *       같은 칸을 공유하는 항목은 합쳐서 저장된다는 사실을 미리 알린다.
 */
export function ChartSaveNotice({ sections, templateName }: { sections: ChartSectionDef[]; templateName: string }) {
  const [open, setOpen] = useState(false);
  const summary = chartMappingSummary(sections);
  if (summary.totalFields === 0) return null;

  const savedToSlot = summary.totalFields - summary.unmapped.length;

  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="text-amber-500 text-xs leading-5">ℹ</span>
        <div className="flex-1 min-w-0 text-[11px] leading-5 text-amber-900">
          <p>
            입력한 값은 <strong>진료기록(SOAP) 본문</strong>에 저장됩니다 — SOAP 지정 {savedToSlot}개
            {summary.unmapped.length > 0 && (
              <>
                , 미지정 {summary.unmapped.length}개는 <strong>{SOAP_SLOT_LABEL[UNMAPPED_SLOT]}</strong>의{' '}
                <code className="rounded bg-white/70 px-1">{unmappedBlockHeader(templateName)}</code> 블록에 라벨과 함께 기록
              </>
            )}
            .
          </p>
          {summary.sharedSlots.length > 0 && (
            <p className="mt-0.5">
              같은 칸을 쓰는 항목은 덮어쓰지 않고 <strong>라벨과 함께 합쳐</strong> 저장합니다
              {' '}({summary.sharedSlots.map((s) => `${SOAP_SLOT_LABEL[s]} ${summary.perSlot[s].length}개`).join(' · ')}).
            </p>
          )}
          {summary.unmapped.length > 0 && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 underline decoration-dotted hover:text-amber-700">
              {open ? '미지정 항목 접기' : `미지정 항목 ${summary.unmapped.length}개 보기`}
            </button>
          )}
          {open && (
            <ul className="mt-1 flex flex-wrap gap-1">
              {summary.unmapped.map((f) => (
                <li key={f.id} className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-amber-800">{f.label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
