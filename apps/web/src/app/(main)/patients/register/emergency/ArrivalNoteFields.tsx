'use client';

/**
 * 응급 도착 상황 기록 입력(등록 화면·환자 상세 "추가 기록" 공용) — 어휘 정본 shared `er-arrival.ts`.
 *
 * 🔴 초기값은 전부 **미선택/빈칸** — 쓰기 폼이 "정상"으로 시작하지 않는다(판정 규칙 §4).
 *    도착 시각을 모르면 비워 둔다(서버가 '지금'으로 채우지 않는다) · 경찰 관여는 예/아니오/모름 3상태.
 */
import {
  ARRIVAL_CONSCIOUSNESS, ARRIVAL_CONSCIOUSNESS_LABEL, ARRIVAL_INFO_SOURCES, ARRIVAL_INFO_SOURCE_LABEL, ARRIVAL_MODES, ARRIVAL_MODE_LABEL,
  ARRIVAL_TEXT_MAX, BELONGING_CUSTODY, BELONGING_CUSTODY_LABEL, COMPANION_TYPES, COMPANION_TYPE_LABEL, INJURY_TYPES, INJURY_TYPE_LABEL,
  type ArrivalNoteInput, type BelongingCustody,
} from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/** 화면 입력 상태 — 시각은 datetime-local 문자열(보낼 때 ISO 로) */
export type ArrivalDraft = Omit<ArrivalNoteInput, 'arrivalAt' | 'foundAt'> & { arrivalAtLocal: string; foundAtLocal: string };
export const EMPTY_ARRIVAL: ArrivalDraft = { arrivalAtLocal: '', foundAtLocal: '', injuryTypes: [], belongings: [] };

/** 입력 상태 → API 본문(빈칸은 보내지 않는다 · 시각은 이 기기의 시간대로 해석해 ISO) */
export function toArrivalPayload(d: ArrivalDraft): ArrivalNoteInput {
  const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);
  const s = (v: string | null | undefined) => (v && v.trim() ? v.trim() : undefined);
  const out: ArrivalNoteInput = {
    arrivalAt: iso(d.arrivalAtLocal), foundAt: iso(d.foundAtLocal),
    arrivalMode: d.arrivalMode ?? undefined, emsUnit: s(d.emsUnit), foundLocation: s(d.foundLocation), circumstance: s(d.circumstance),
    consciousness: d.consciousness ?? undefined, injuryTypes: d.injuryTypes?.length ? d.injuryTypes : undefined,
    companionType: d.companionType ?? undefined, companionName: s(d.companionName), companionContact: s(d.companionContact), companionRelation: s(d.companionRelation),
    belongings: d.belongings?.filter((b) => b.item.trim()).map((b) => ({ item: b.item.trim(), custody: b.custody })),
    identifyingFeatures: s(d.identifyingFeatures),
    policeInvolved: d.policeInvolved ?? undefined, policeAgency: s(d.policeAgency), policeOfficer: s(d.policeOfficer), policeCaseNo: s(d.policeCaseNo),
    infoSource: d.infoSource ?? undefined, note: s(d.note),
  };
  if (!out.belongings?.length) delete out.belongings;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as ArrivalNoteInput;
}

const chip = (on: boolean, tone: 'red' | 'indigo' = 'indigo') =>
  `min-h-[36px] rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${on
    ? tone === 'red' ? 'border-red-500 bg-red-50 text-red-700' : 'border-indigo-500 bg-indigo-50 text-indigo-700'
    : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`;
const input = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';
const label = 'text-xs font-medium text-gray-600';
const section = 'space-y-2 rounded-xl border border-gray-100 bg-gray-50/40 p-3';

export function ArrivalNoteFields({ value, onChange }: { value: ArrivalDraft; onChange: (v: ArrivalDraft) => void }) {
  const tA = useTAttr();
  const set = <K extends keyof ArrivalDraft>(k: K, v: ArrivalDraft[K]) => onChange({ ...value, [k]: v });
  /** 한 번 더 누르면 선택 해제(미선택으로 돌아갈 수 있어야 한다) */
  const toggle = <K extends keyof ArrivalDraft>(k: K, v: ArrivalDraft[K]) => set(k, (value[k] === v ? null : v) as ArrivalDraft[K]);
  const belongings = value.belongings ?? [];
  const showEms = value.arrivalMode === 'AMBULANCE_119' || value.arrivalMode === 'AMBULANCE_PRIVATE' || value.arrivalMode === 'TRANSFER' || value.arrivalMode === 'HELICOPTER';

  return (
    <div className="space-y-3">
      {/* 도착 */}
      <div className={section}>
        <p className="text-xs font-bold text-gray-800"><T k="도착" /></p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className={label}><T k="도착 시각" /> <span className="text-gray-400"><T k="(모르면 비워 두세요)" /></span></label>
            <input type="datetime-local" value={value.arrivalAtLocal} onChange={(e) => set('arrivalAtLocal', e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}><T k="도착 시 의식(AVPU)" /></label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ARRIVAL_CONSCIOUSNESS.map((c) => (
                <button key={c} type="button" onClick={() => toggle('consciousness', c)} className={chip(value.consciousness === c)}>{tA(ARRIVAL_CONSCIOUSNESS_LABEL[c])}</button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className={label}><T k="내원 수단" /></label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ARRIVAL_MODES.map((m) => (
              <button key={m} type="button" onClick={() => toggle('arrivalMode', m)} className={chip(value.arrivalMode === m)}>{tA(ARRIVAL_MODE_LABEL[m])}</button>
            ))}
          </div>
        </div>
        {showEms && (
          <div>
            <label className={label}><T k="구급대·이송 기관" /></label>
            <input value={value.emsUnit ?? ''} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('emsUnit', e.target.value)} placeholder={tA('예: 가상시소방서 ○○119안전센터')} className={input} />
          </div>
        )}
      </div>

      {/* 발견 경위 */}
      <div className={section}>
        <p className="text-xs font-bold text-gray-800"><T k="발견 경위" /></p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className={label}><T k="발견 장소" /></label>
            <input value={value.foundLocation ?? ''} maxLength={ARRIVAL_TEXT_MAX.place} onChange={(e) => set('foundLocation', e.target.value)} placeholder={tA('예: ○○동 버스정류장 앞')} className={input} />
          </div>
          <div>
            <label className={label}><T k="발견 시각" /> <span className="text-gray-400"><T k="(모르면 비워 두세요)" /></span></label>
            <input type="datetime-local" value={value.foundAtLocal} onChange={(e) => set('foundAtLocal', e.target.value)} className={input} />
          </div>
        </div>
        <div>
          <label className={label}><T k="발견·도착 경위" /></label>
          <textarea value={value.circumstance ?? ''} maxLength={ARRIVAL_TEXT_MAX.long} rows={3} onChange={(e) => set('circumstance', e.target.value)}
            placeholder={tA('누가 어떻게 발견했고 어떤 상태였는지 — 들은 대로 적고 추측은 추측이라고 적습니다')} className={`${input} resize-none`} />
        </div>
        <div>
          <label className={label}><T k="손상 유형" /> <span className="text-gray-400"><T k="(여럿 선택)" /></span></label>
          <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {INJURY_TYPES.map((t) => {
              const on = value.injuryTypes?.includes(t) ?? false;
              return (
                <button key={t} type="button" className={chip(on, 'red')}
                  onClick={() => set('injuryTypes', on ? (value.injuryTypes ?? []).filter((x) => x !== t) : [...(value.injuryTypes ?? []), t])}>
                  {tA(INJURY_TYPE_LABEL[t])}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 동행·인계자 */}
      <div className={section}>
        <p className="text-xs font-bold text-gray-800"><T k="동행·인계자" /></p>
        <div className="flex flex-wrap gap-1.5">
          {COMPANION_TYPES.map((c) => (
            <button key={c} type="button" onClick={() => toggle('companionType', c)} className={chip(value.companionType === c)}>{tA(COMPANION_TYPE_LABEL[c])}</button>
          ))}
        </div>
        {value.companionType && value.companionType !== 'NONE' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input value={value.companionName ?? ''} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('companionName', e.target.value)} placeholder={tA('이름')} className={input} aria-label={tA('동행인 이름')} />
            <input value={value.companionContact ?? ''} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('companionContact', e.target.value)} placeholder={tA('연락처')} className={input} aria-label={tA('동행인 연락처')} />
            <input value={value.companionRelation ?? ''} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('companionRelation', e.target.value)} placeholder={tA('환자와의 관계')} className={input} aria-label={tA('환자와의 관계')} />
          </div>
        )}
      </div>

      {/* 소지품·신원 단서 */}
      <div className={section}>
        <p className="text-xs font-bold text-gray-800"><T k="소지품·신원 단서" /></p>
        {belongings.map((b, i) => (
          <div key={i} className="flex gap-2">
            <input value={b.item} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('belongings', belongings.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))}
              placeholder={tA('품목(예: 휴대전화·지갑·열쇠)')} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" aria-label={tA('소지품')} />
            <select value={b.custody} onChange={(e) => set('belongings', belongings.map((x, j) => (j === i ? { ...x, custody: e.target.value as BelongingCustody } : x)))}
              className="rounded-xl border bg-white px-2 py-2 text-sm" aria-label={tA('보관')}>
              {BELONGING_CUSTODY.map((c) => <option key={c} value={c}>{tA(BELONGING_CUSTODY_LABEL[c])}</option>)}
            </select>
            <button type="button" onClick={() => set('belongings', belongings.filter((_, j) => j !== i))} className="min-h-[36px] rounded-lg px-2 text-xs text-gray-500 hover:bg-gray-100" aria-label={tA('삭제')}>✕</button>
          </div>
        ))}
        <button type="button" onClick={() => set('belongings', [...belongings, { item: '', custody: 'UNKNOWN' }])} className="min-h-[36px] rounded-lg border border-dashed px-3 text-xs text-gray-600 hover:bg-white">
          + <T k="소지품 추가" />
        </button>
        <div>
          <label className={label}><T k="신체 특징·착의" /></label>
          <textarea value={value.identifyingFeatures ?? ''} maxLength={ARRIVAL_TEXT_MAX.long} rows={2} onChange={(e) => set('identifyingFeatures', e.target.value)}
            placeholder={tA('예: 오른팔 용 문신 · 검정 패딩 · 흰 운동화 · 안경')} className={`${input} resize-none`} />
        </div>
      </div>

      {/* 경찰 */}
      <div className={section}>
        <p className="text-xs font-bold text-gray-800"><T k="경찰 관여" /></p>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => set('policeInvolved', value.policeInvolved === true ? null : true)} className={chip(value.policeInvolved === true)}><T k="있음" /></button>
          <button type="button" onClick={() => set('policeInvolved', value.policeInvolved === false ? null : false)} className={chip(value.policeInvolved === false)}><T k="없음" /></button>
          <span className="self-center text-[11px] text-gray-400"><T k="(모르면 선택하지 않음)" /></span>
        </div>
        {value.policeInvolved === true && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input value={value.policeAgency ?? ''} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('policeAgency', e.target.value)} placeholder={tA('소속(예: ○○경찰서 ○○지구대)')} className={input} aria-label={tA('경찰 소속')} />
            <input value={value.policeOfficer ?? ''} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('policeOfficer', e.target.value)} placeholder={tA('담당자·연락처')} className={input} aria-label={tA('경찰 담당자')} />
            <input value={value.policeCaseNo ?? ''} maxLength={ARRIVAL_TEXT_MAX.short} onChange={(e) => set('policeCaseNo', e.target.value)} placeholder={tA('사건·접수 번호')} className={input} aria-label={tA('사건 번호')} />
          </div>
        )}
      </div>

      {/* 출처·메모 */}
      <div className={section}>
        <p className="text-xs font-bold text-gray-800"><T k="이 기록의 정보 출처" /></p>
        <div className="flex flex-wrap gap-1.5">
          {ARRIVAL_INFO_SOURCES.map((s) => (
            <button key={s} type="button" onClick={() => toggle('infoSource', s)} className={chip(value.infoSource === s)}>{tA(ARRIVAL_INFO_SOURCE_LABEL[s])}</button>
          ))}
        </div>
        <div>
          <label className={label}><T k="메모" /></label>
          <textarea value={value.note ?? ''} maxLength={ARRIVAL_TEXT_MAX.long} rows={3} onChange={(e) => set('note', e.target.value)}
            placeholder={tA('그 밖에 남길 것 — 인계 받은 내용, 확인이 필요한 점')} className={`${input} resize-none`} />
          <p className="mt-0.5 text-right text-[10px] text-gray-400">{(value.note ?? '').length} / {ARRIVAL_TEXT_MAX.long}</p>
        </div>
      </div>
    </div>
  );
}
