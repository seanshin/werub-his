'use client';

/** SOAP 빠른문구 칩 — 탭 시 해당 필드에 문구 삽입(키보드 의존 축소). */
const PHRASES: Record<'S' | 'O' | 'A' | 'P', string[]> = {
  S: ['특이 호소 없음', '증상 호전', '통증 지속', '발열 호소', '기침/가래', '소화불량'],
  O: ['활력징후 안정', 'BP 정상', '청진상 정상', '복부 부드러움', '부종 없음'],
  A: ['상태 호전', '경과 관찰 요함', '추가 검사 필요', '만성질환 조절 양호'],
  P: ['약물 유지', '경과 관찰', '2주 후 외래 추적', '식이·운동 교육', '추가 검사 처방'],
};

export default function QuickPhraseChips({ field, onInsert }: { field: 'S' | 'O' | 'A' | 'P'; onInsert: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {PHRASES[field].map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onInsert(p)}
          className="px-3 min-h-[36px] rounded-full bg-blue-50 text-blue-700 text-sm font-medium active:bg-blue-100 whitespace-nowrap"
        >
          + {p}
        </button>
      ))}
    </div>
  );
}
