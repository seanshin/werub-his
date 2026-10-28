'use client';

/**
 * 검색이 **어떻게** 찾았는지 말하는 줄.
 *
 * 🔴 발단(2026-08-26 운영 실측): 약어를 치면 **없는 것이 아니라 전혀 다른 것**이 나왔다.
 *    `AMI`→248건(1위 "일반 성인 의학적 검사"=ex**AMI**nation) · `HTN`→11건(전부 "**벼락**"=lig**HTN**ing)
 *    `PE`→7,592건. 단어 단위로는 전부 0건이었다 — **0건보다 나쁘다.**
 *
 * 🔴 서버가 판정하고 화면은 **그대로 말한다**(여기서 다시 판정하지 않는다).
 * 🔴 좁힘·확장이 없었으면 **아무것도 그리지 않는다** — 늘 붙는 안내는 읽히지 않는다.
 */
import { T, Tf } from '@/components/ui/i18n-text';

export interface CodeSearchMeta {
  synonyms: { term: string; expandsTo: string | null; code: string | null; kind: string }[];
  narrowed: boolean;
  widenedByRequest: boolean;
  note: string | null;
  truncated: boolean;
  /** `null` 은 **산출 불가**이지 0 이 아니다 */
  wideCount: number | null;
}

const KIND_LABEL: Record<string, string> = {
  ABBREVIATION: '약어',
  COLLOQUIAL: '구어',
  ENGLISH: '영문',
  LEGACY: '옛 표기',
  TYPO: '흔한 오타',
};

export function CodeSearchNotice({
  meta,
  resultCount,
  wide,
  onWide,
}: {
  meta: CodeSearchMeta | null | undefined;
  resultCount: number;
  wide: boolean;
  onWide: (v: boolean) => void;
}) {
  if (!meta) return null;
  const { synonyms, narrowed, widenedByRequest, note, wideCount, truncated } = meta;
  const hasSynonym = synonyms.length > 0;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] leading-relaxed text-gray-700">
      {hasSynonym && (
        <p>
          <T k="동의어로 넓혀 찾았습니다 —" />{' '}
          {synonyms.map((s, i) => (
            <span key={`${s.term}-${i}`}>
              {i > 0 && ' · '}
              <b>{s.term}</b>
              <span className="text-gray-400"> <T k={KIND_LABEL[s.kind] ?? s.kind} /></span>
              {s.expandsTo && <> → <b>{s.expandsTo}</b></>}
              {s.code && <> → <Tf k="코드 {코드}" params={{ 코드: <b>{s.code}</b> }} /></>}
            </span>
          ))}
        </p>
      )}

      {narrowed && (
        <div className={hasSynonym ? 'mt-2' : ''}>
          <p>{note}</p>
          <p className="mt-1 text-gray-500">
            {resultCount === 0
              ? <T k="단어 단위로 일치하는 코드가 없습니다." />
              : <Tf k="단어 단위로 {수}건을 찾았습니다." params={{ 수: resultCount }} />}
            {/* 🔴 넓히면 몇 건인지 **미리 말하고**, 넓히는 것은 사람이 누른다.
                자동으로 되넓히면 좁힌 의미가 사라진다(PE 는 7,592건이 되고 그중 폐색전은 없다). */}
            {wideCount === null ? (
              <span className="text-gray-400"> <T k="넓혔을 때 몇 건인지는 산출하지 못했습니다." /></span>
            ) : wideCount > resultCount ? (
              <>
                {' '}<Tf k="이름 일부까지 넓히면 {수}건이며 대부분 약어와 무관합니다." params={{ 수: wideCount.toLocaleString() }} />{' '}
                <button
                  type="button"
                  onClick={() => onWide(true)}
                  className="font-semibold text-blue-600 underline underline-offset-2"
                >
                  <T k="그래도 넓혀 보기" />
                </button>
              </>
            ) : null}
          </p>
          {truncated && (
            <p className="mt-1 text-amber-700">
              <T k="후보가 많아 일부만 검사했습니다 — 결과가 전부가 아닐 수 있습니다." />
            </p>
          )}
        </div>
      )}

      {widenedByRequest && (
        <div className={hasSynonym ? 'mt-2' : ''}>
          <p className="text-amber-700">{note}</p>
          <button
            type="button"
            onClick={() => onWide(false)}
            className="mt-1 font-semibold text-blue-600 underline underline-offset-2"
          >
            <T k="단어 단위로 되돌리기" />
          </button>
        </div>
      )}
    </div>
  );
}

/** 동의어가 **직접 지목한** 코드 — 목록에 섞지 않고 위에 따로 낸다(총 건수가 어긋나지 않게) */
export function PinnedCodes({
  pinned,
  onSelect,
}: {
  pinned: { id: string; code: string; nameKo: string }[];
  onSelect?: (c: { id: string; code: string; nameKo: string }) => void;
}) {
  if (!pinned?.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
      <p className="text-[11px] font-semibold text-blue-800">
        <T k="원내에서 이 검색어에 지정해 둔 코드" />
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pinned.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect?.(c)}
            className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-left text-[12px] hover:border-blue-400"
          >
            <span className="font-mono font-semibold text-blue-700">{c.code}</span>
            <span className="ml-2 text-gray-700">{c.nameKo}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
