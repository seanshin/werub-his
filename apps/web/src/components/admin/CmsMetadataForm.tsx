'use client';

import { useMemo, useState } from 'react';
import {
  cmsCategoryDef, cmsDisplayGaps, cmsUnknownKeys, cmsValueIsEmpty, cmsResolveStyle,
  CMS_STYLE_PRESETS,
  type CmsFieldDef,
} from '@hospital-run/shared';

/**
 * CMS 구조화 데이터(metadata) 편집기 — **정본은 `@hospital-run/shared` 의 `CMS_CATEGORIES`**.
 *
 * 🔴 왜 만들었나(2026-08-21 실측): 관리 화면 두 곳 모두 metadata 를 **생 JSON textarea** 로만
 *    편집했다. 편집자는 카테고리마다 어떤 키가 필요한지, 그 값이 공개 화면에서 무엇이 되는지
 *    알 방법이 없었다. 그 결과 **공개 화면이 읽는데 DB 에 0행인 키**가 여럿 생겼다
 *    (NEWS thumbnailUrl · CENTER features · GALLERY images · HEALTH_INFO ageGroup/category/season).
 *
 * 🔴 미지의 키는 **지우지 않는다.** 정본에 없는 키도 그대로 보존해 '고급' 영역에서 편집한다 —
 *    "화면에 없는 필드를 조용히 삭제"하는 것은 이 저장소에서 이미 데이터를 잃은 방식이다
 *    (전역 whitelist:true 가 DTO 에 없는 키를 지워 진료 입력이 사라진 사건).
 */

export interface CmsMetadataFormProps {
  category: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** 대표 이미지 — 카테고리에 따라 "공개 화면이 이것을 읽는다"를 함께 말하기 위해 받는다. */
  imageUrl?: string;
}

/** 배열 필드의 입력 표기(줄바꿈 구분) ↔ 저장 표기(string[]) */
const listToText = (v: unknown): string => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : typeof v === 'string' ? v : '');
const textToList = (t: string): string[] => t.split('\n').map((s) => s.trim()).filter(Boolean);

const INPUT = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none';

export function CmsMetadataForm({ category, value, onChange, imageUrl }: CmsMetadataFormProps) {
  const def = cmsCategoryDef(category);
  const [rawOpen, setRawOpen] = useState(false);

  const gaps = useMemo(() => cmsDisplayGaps(category, { metadata: value, imageUrl }), [category, value, imageUrl]);
  const unknown = useMemo(() => cmsUnknownKeys(category, value), [category, value]);
  const style = useMemo(() => cmsResolveStyle(value), [value]);

  const set = (key: string, v: unknown) => {
    const next = { ...value };
    // 🔴 빈 값은 키를 지운다 — `""` 를 남기면 "값이 있다"로 읽힌다(빈 문자열은 값이 아니다)
    if (cmsValueIsEmpty(v)) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  if (!def) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-2">
        <h3 className="text-sm font-bold text-gray-800">구조화 데이터</h3>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          이 카테고리(<code className="font-mono">{category}</code>)는 필드 정본에 등재되어 있지 않습니다 —
          공개 화면이 무엇을 읽는지 알 수 없어 <b>구조화 폼을 그리지 못합니다</b>. 아래 JSON 으로만 편집됩니다.
        </p>
        <RawJson value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 어디에 나오는가 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-800">{def.icon} 공개 화면 항목</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {def.publicPaths.length > 0
                ? <>이 항목은 <b>{def.publicPaths.join(' · ')}</b> 에 표시됩니다.</>
                : <span className="text-amber-700">이 카테고리를 읽는 공개 화면이 확인되지 않았습니다 — 저장해도 홈페이지에 나오지 않습니다.</span>}
            </p>
          </div>
          <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${
            def.imageRole === 'REQUIRED' ? 'bg-rose-50 text-rose-700'
              : def.imageRole === 'OPTIONAL' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
            대표 이미지 {def.imageRole === 'REQUIRED' ? '필수' : def.imageRole === 'OPTIONAL' ? '선택' : '미사용'}
          </span>
        </div>

        {/* 🔴 공개 화면이 읽는데 비어 있는 것 — 저장은 막지 않는다(강제하면 거짓 값이 채워진다) */}
        {gaps.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-amber-900">
              공개 화면이 읽는데 비어 있는 항목 <b>{gaps.length}</b>건 — 저장은 됩니다. 다만 홈페이지는 이렇게 그립니다:
            </p>
            <ul className="mt-1.5 space-y-1">
              {gaps.map((g) => (
                <li key={g.key} className="text-[11px] text-amber-800 leading-relaxed">
                  <b>{g.label}</b> — {g.usedFor}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 구조화 필드 */}
      {def.fields.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-800">항목 정보</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {def.fields.map((f) => (
              <Field key={f.key} f={f} v={value[f.key]} onSet={(v) => set(f.key, v)} span={f.type === 'list' || f.type === 'textarea'} />
            ))}
          </div>

          {/* 색상 프리셋이 있는 카테고리는 실제 결과를 미리 보여준다 */}
          {def.fields.some((f) => f.key === 'stylePreset') && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-[11px] font-medium text-gray-500 mb-2">
                미리보기 — 대표 이미지가 없을 때 홈페이지가 그리는 모습
                <span className="ml-1.5 text-[10px] text-gray-400">
                  ({style.source === 'PRESET' ? `프리셋 ${style.presetKey}` : style.source === 'CUSTOM' ? '직접 지정 색' : '기본 프리셋'})
                </span>
              </p>
              <div className="rounded-2xl overflow-hidden border border-gray-200">
                <div className="px-6 py-8 flex flex-col items-center justify-center gap-3 text-center"
                  style={{ backgroundImage: style.gradient, backgroundColor: style.bg, color: style.text }}>
                  <p className="text-base font-extrabold leading-snug">{(value.__previewTitle as string) || '배너 제목이 여기에 표시됩니다'}</p>
                  {typeof value.linkText === 'string' && value.linkText && (
                    <span className="inline-flex items-center rounded-full px-4 py-1.5 text-xs font-bold"
                      style={{ backgroundColor: style.accent, color: style.accentText }}>
                      {value.linkText}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CMS_STYLE_PRESETS.map((p) => (
                  <button key={p.key} type="button" onClick={() => set('stylePreset', p.key)}
                    title={p.hint}
                    className={`w-8 h-8 rounded-lg border-2 transition ${style.presetKey === p.key ? 'border-blue-500 scale-110' : 'border-white shadow-sm'}`}
                    style={{ backgroundImage: p.gradient, backgroundColor: p.bg }}
                    aria-label={`${p.label} — ${p.hint}`} />
                ))}
                {value.stylePreset != null && (
                  <button type="button" onClick={() => set('stylePreset', '')}
                    className="text-[10px] text-gray-500 underline underline-offset-2 px-1">프리셋 해제</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 고급 — 정본에 없는 키도 보존한다 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <button type="button" onClick={() => setRawOpen((o) => !o)}
          className="w-full flex items-center justify-between text-left">
          <span className="text-sm font-bold text-gray-800">고급: 구조화 데이터(JSON)</span>
          <span className="text-[11px] text-gray-400">
            {unknown.length > 0 ? `정본 외 키 ${unknown.length}개 보존 중 · ` : ''}{rawOpen ? '접기' : '펼치기'}
          </span>
        </button>
        {unknown.length > 0 && !rawOpen && (
          <p className="mt-2 text-[11px] text-gray-500">
            <code className="font-mono">{unknown.join(', ')}</code> — 위 폼에 없는 키입니다. <b>지우지 않고 그대로 저장됩니다.</b>
          </p>
        )}
        {rawOpen && (
          <div className="mt-3">
            <RawJson value={value} onChange={onChange} />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ f, v, onSet, span }: { f: CmsFieldDef; v: unknown; onSet: (v: unknown) => void; span?: boolean }) {
  const empty = cmsValueIsEmpty(v);
  return (
    <div className={span ? 'col-span-2' : ''}>
      <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 mb-1">
        {f.label}
        {f.requiredForDisplay && (
          <span className={`text-[9px] px-1 rounded ${empty ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {empty ? '화면에 필요 · 비어 있음' : '화면에 필요'}
          </span>
        )}
      </label>

      {f.type === 'select' ? (
        <select value={typeof v === 'string' ? v : ''} onChange={(e) => onSet(e.target.value)} className={INPUT}>
          <option value="">(미지정)</option>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.type === 'list' ? (
        <textarea rows={3} value={listToText(v)} onChange={(e) => onSet(textToList(e.target.value))}
          placeholder={f.placeholder ?? '한 줄에 하나씩 입력'} className={`${INPUT} font-normal`} />
      ) : f.type === 'textarea' ? (
        <textarea rows={3} value={typeof v === 'string' ? v : ''} onChange={(e) => onSet(e.target.value)}
          placeholder={f.placeholder} className={INPUT} />
      ) : f.type === 'color' ? (
        <div className="flex items-center gap-2">
          <input type="color" value={typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#0f2a4a'}
            onChange={(e) => onSet(e.target.value)} className="w-9 h-9 rounded-lg border border-gray-200 p-0.5 bg-white" />
          <input value={typeof v === 'string' ? v : ''} onChange={(e) => onSet(e.target.value)}
            placeholder="#0f2a4a" className={`${INPUT} font-mono`} />
        </div>
      ) : f.type === 'number' ? (
        <input type="number" value={typeof v === 'number' || typeof v === 'string' ? String(v) : ''}
          onChange={(e) => onSet(e.target.value === '' ? '' : Number(e.target.value))} className={INPUT} />
      ) : (
        <input
          type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
          value={typeof v === 'string' ? v : ''} onChange={(e) => onSet(e.target.value)}
          placeholder={f.placeholder} className={INPUT} />
      )}

      <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">{f.usedFor}</p>
    </div>
  );
}

/**
 * 원시 JSON 편집 — 🔴 파싱 실패 시 **상위 상태를 건드리지 않는다**.
 * 종전 편집기는 파싱 실패를 `{}` 로 삼켜 오타 한 글자에 구조화 데이터가 통째로 사라졌다.
 */
function RawJson({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  // 폼 쪽 편집이 반영되도록, 포커스가 없을 때는 상위 값을 따라간다
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : JSON.stringify(value, null, 2);

  return (
    <>
      <textarea
        rows={8}
        value={shown}
        onFocus={() => { setText(JSON.stringify(value, null, 2)); setFocused(true); }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim();
          if (!t) { setErr(null); onChange({}); return; }
          try {
            const parsed = JSON.parse(t);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setErr('구조화 데이터는 { } 객체여야 합니다 — 반영하지 않았습니다'); return;
            }
            setErr(null);
            onChange(parsed as Record<string, unknown>);
          } catch {
            setErr('JSON 형식이 올바르지 않습니다 — 반영하지 않았습니다(입력은 그대로 둡니다)');
          }
        }}
        className={`w-full px-3 py-2 border rounded-lg text-xs font-mono ${err ? 'border-rose-300 bg-rose-50/40' : 'border-gray-200'}`}
      />
      {err && <p className="mt-1 text-[11px] text-rose-700">{err}</p>}
    </>
  );
}
