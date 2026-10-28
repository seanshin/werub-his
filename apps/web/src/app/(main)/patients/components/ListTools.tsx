'use client';

/**
 * 환자 목록 도구(2026-10-20 환자 목록 P4 · `patients-list-refinement-2026-10.plan.md` B6~B9).
 *  - B6 오래된 작성 중 기록 칩 — 서버가 준 수만 · 의사는 본인 것(할 일함으로) · 관리자는 수만 · 칸이 없으면 그리지 않는다
 *  - B7 열 고르기·밀도 — 사용자 편의라 브라우저 저장소(localStorage)에만 · 🔴 읽기·쓰기 실패해도 기본 열로 그린다
 *    필수 열(등록번호·이름·생년월일·성별)은 숨길 수 없다 — 찾는 화면에서 사람을 구분하는 최소 열
 *  - B8 키보드 — `/` 검색 · ↑↓ 행 이동 · Enter 차트 · Esc 검색 벗어나기(입력 중에는 가로채지 않는다)
 *  - B9 선택 행 일괄 — 라벨 인쇄(원장 미등재 표기) · CSV(반출 권한만 · 서버 감사에 고른 id) · 🔴 일괄 병합·삭제는 하지 않는다
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ageOf, genderText, joinPatientName } from '@hospital-run/shared';
import { PrintDoc, useDocHash } from '@/components/print/PrintSheet';
import { KDate } from '@/components/ui/display';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import type { PatientListItem } from '@/types/patient';

// ── B6 ──
/** @param asLink false = 카드처럼 이미 링크 안에 있을 때(링크 안에 링크를 두지 않는다) */
export function StaleDraftChip({ stale, mode, days, asLink = true }: { stale?: { count: number; oldestAt: string | null }; mode?: 'MINE' | 'ALL' | null; days?: number; asLink?: boolean }) {
  const tfA = useTfAttr();
  if (!stale || !mode || !stale.count) return null;
  const title = stale.oldestAt ? tfA('가장 오래된 작성 중 기록 {시각}', { 시각: new Date(stale.oldestAt).toLocaleDateString() }) : undefined;
  const cls = 'whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800';
  if (mode === 'MINE' && asLink) {
    return (
      <Link href="/doctor-inbox" className={`${cls} hover:bg-amber-100`} title={title} data-stale-drafts="MINE">
        <Tf k="{일}일 넘은 내 작성 중 {수}" params={{ 일: days ?? '?', 수: stale.count }} />
      </Link>
    );
  }
  return (
    <span className={cls} title={title} data-stale-drafts={mode}>
      <Tf k={mode === 'MINE' ? '{일}일 넘은 내 작성 중 {수}' : '{일}일 넘은 작성 중 {수}'} params={{ 일: days ?? '?', 수: stale.count }} />
    </span>
  );
}

// ── B7 ──
export const OPTIONAL_COLUMNS = [
  { key: 'allergy', label: '알레르기' },
  { key: 'visit', label: '최근 방문 · 다음 예약' },
  { key: 'encounters', label: '서명된 진료' },
  { key: 'insurance', label: '보험' },
  { key: 'phone', label: '연락처' },
  { key: 'tags', label: '태그' },
] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]['key'];
export type Density = 'comfortable' | 'compact';

const PREFS_KEY = 'his.patients.listPrefs.v1';
type Prefs = { hidden: OptionalColumn[]; density: Density };
const DEFAULT_PREFS: Prefs = { hidden: [], density: 'comfortable' };
const KNOWN = new Set<string>(OPTIONAL_COLUMNS.map((c) => c.key));

/** 저장된 값 → 설정(모양이 다르거나 읽기 실패면 기본값) */
export function readListPrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<Prefs>;
    return {
      hidden: Array.isArray(v.hidden) ? (v.hidden.filter((k) => KNOWN.has(k)) as OptionalColumn[]) : [],
      density: v.density === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useListPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    try { setPrefs(readListPrefs(window.localStorage.getItem(PREFS_KEY))); } catch { /* 저장소 막힘 — 기본 열 */ }
  }, []);
  const save = useCallback((next: Prefs) => {
    setPrefs(next);
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* 저장 실패 — 이번 화면에만 적용 */ }
  }, []);
  return {
    hidden: prefs.hidden,
    density: prefs.density,
    isHidden: (k: OptionalColumn) => prefs.hidden.includes(k),
    toggle: (k: OptionalColumn) => save({ ...prefs, hidden: prefs.hidden.includes(k) ? prefs.hidden.filter((x) => x !== k) : [...prefs.hidden, k] }),
    setDensity: (density: Density) => save({ ...prefs, density }),
    reset: () => save(DEFAULT_PREFS),
  };
}

/** 열 고르기 — 이 역할에 있는 열만 고를 수 있다(권한 밖 열은 목록에도 없다) */
export function ColumnPicker({ available, prefs }: { available: OptionalColumn[]; prefs: ReturnType<typeof useListPrefs> }) {
  const tA = useTAttr();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 넓은 패널(240px) — 왼쪽으로 뻗어 본문에 잘리지 않게 여는 방향 정본으로
  const { alignClass } = useEdgeSafeAlign(open, 240, ref);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={tA('보일 열과 행 간격을 고릅니다 — 이 브라우저에만 저장됩니다')}
        className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        data-column-picker
      >
        <T k="열" />
      </button>
      {open && (
        <div className={`absolute ${alignClass} z-20 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-lg`} data-column-menu>
          <p className="mb-1.5 text-[11px] font-medium text-gray-400"><T k="보일 열" /></p>
          {OPTIONAL_COLUMNS.filter((c) => available.includes(c.key)).map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 py-1">
              <input type="checkbox" checked={!prefs.isHidden(c.key)} onChange={() => prefs.toggle(c.key)} data-column-toggle={c.key} />
              <T k={c.label} />
            </label>
          ))}
          <p className="mt-1 text-[10px] text-gray-400"><T k="등록번호·이름·생년월일·성별은 늘 보입니다." /></p>
          <p className="mb-1.5 mt-3 text-[11px] font-medium text-gray-400"><T k="행 간격" /></p>
          <div className="flex gap-1.5">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button
                key={d}
                onClick={() => prefs.setDensity(d)}
                aria-pressed={prefs.density === d}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${prefs.density === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                data-density={d}
              >
                <T k={d === 'compact' ? '촘촘하게' : '기본'} />
              </button>
            ))}
          </div>
          <button onClick={prefs.reset} className="mt-3 text-xs text-gray-500 hover:text-gray-800" data-prefs-reset><T k="기본으로" /></button>
        </div>
      )}
    </div>
  );
}

// ── B8 ──
const typingIn = (el: Element | null) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable);

/**
 * 키보드 이동 — 🔴 입력 칸·대화창 안에서는 가로채지 않는다(`/` 를 검색어로 치는 사람이 있다) · 수정 키 조합도 그대로 둔다.
 * @param enabled 창(병합·가져오기 등)이 열려 있으면 false
 */
export function useListKeyboard({ count, enabled, onOpen, searchRef }: { count: number; enabled: boolean; onOpen: (index: number) => void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const [active, setActive] = useState(-1);
  useEffect(() => { setActive((a) => (a >= count ? count - 1 : a)); }, [count]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (e.key === 'Escape' && el === searchRef.current) { searchRef.current?.blur(); return; }
      if (typingIn(el)) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (!count) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(count - 1, a + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); onOpen(active); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, count, active, onOpen, searchRef]);
  useEffect(() => {
    if (active < 0) return;
    const row = document.querySelector<HTMLElement>(`[data-row-index="${active}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  return { active, setActive };
}

// ── B9 ──
/** 한 번에 고를 수 있는 수 — 반출 EP 의 id 상한과 같다 */
export const SELECT_MAX = 100;

export function useRowSelection() {
  const [sel, setSel] = useState<Map<string, PatientListItem>>(new Map());
  const toggle = useCallback((p: PatientListItem) => setSel((m) => {
    const n = new Map(m);
    if (n.has(p.id)) n.delete(p.id);
    else if (n.size < SELECT_MAX) n.set(p.id, p);
    return n;
  }), []);
  const setPage = useCallback((rows: PatientListItem[], on: boolean) => setSel((m) => {
    const n = new Map(m);
    for (const p of rows) {
      if (!on) n.delete(p.id);
      else if (n.size < SELECT_MAX) n.set(p.id, p);
    }
    return n;
  }), []);
  return { selected: sel, toggle, setPage, clear: () => setSel(new Map()) };
}

export function BulkBar({ count, onPrintLabels, onExport, onClear }: { count: number; onPrintLabels: () => void; onExport?: () => void; onClear: () => void }) {
  if (!count) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 text-sm" data-bulk-bar>
      <span className="font-medium text-blue-800"><Tf k="{수}명 선택" params={{ 수: count }} /></span>
      {count >= SELECT_MAX && <span className="text-[11px] text-amber-700" data-select-max><Tf k="한 번에 {수}명까지 고를 수 있습니다" params={{ 수: SELECT_MAX }} /></span>}
      <button onClick={onPrintLabels} className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50" data-bulk-labels>
        <T k="라벨 인쇄" />
      </button>
      {onExport && (
        <button onClick={onExport} className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50" data-bulk-export>
          <T k="고른 환자 CSV" />
        </button>
      )}
      <button onClick={onClear} className="ml-auto text-xs text-gray-500 hover:text-gray-800" data-bulk-clear><T k="선택 해제" /></button>
    </div>
  );
}

/** 라벨 인쇄본 QR — 🔴 PHI 없음(이름·등록번호·생년월일을 넣지 않는다) */
export function patientLabelsQrPayload(p: { at: string; count: number }) {
  return { t: 'HIS-PATIENT-LABELS', v: 1, at: p.at, count: p.count };
}

/**
 * 환자 라벨 인쇄본 — 목록이 이미 받은 값만(새 조회 없음) · 모르는 값은 "미상"으로(지어내지 않는다).
 * 환자 정보 인쇄본이라 발급 원장에 올리지 않는다(결정 `print.issue.phiRetention` 전 — 원장 미등재 표기).
 */
export function PatientLabelsPrint({ patients }: { patients: PatientListItem[] }) {
  const at = useMemo(() => new Date().toISOString(), [patients]);
  const hash = useDocHash(useMemo(() => patients.map((p) => p.id).join('\n'), [patients]));
  const rows: PatientListItem[][] = [];
  for (let i = 0; i < patients.length; i += 3) rows.push(patients.slice(i, i + 3));
  return (
    <PrintDoc
      attr="PATIENT_LABELS"
      kind={<T k="환자 라벨" />}
      code="HIS-PATIENT-LABELS v1"
      title={<Tf k="환자 라벨 {수}명" params={{ 수: patients.length }} />}
      subtitle={<><T k="출력 시각" /> <KDate value={at} mode="datetime" /></>}
      qr={patientLabelsQrPayload({ at, count: patients.length })}
      hash={hash} unissued="PENDING_D2"
      signOff={false}
      legend={<T k="환자 목록이 이미 받은 값만 실었습니다 — 붙이기 전에 환자 확인(이름·생년월일)을 합니다." />}
    >
      <table data-print-labels>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {[0, 1, 2].map((j) => {
                const p = r[j];
                if (!p) return <td key={j} />;
                const age = ageOf(p.dateOfBirth ?? null);
                return (
                  <td key={j} data-print-label={p.id} style={{ height: '28mm' }}>
                    <b style={{ fontSize: '11pt' }}>{joinPatientName(p.familyName, p.givenName) || <T k="이름 미상" />}</b>
                    <br /><span className="dps-mono">{p.mrn || <T k="등록번호 미상" />}</span>
                    <br />{p.dateOfBirth ? <KDate value={p.dateOfBirth} mode="date" /> : <T k="생년월일 미상" />}
                    {age != null && <> (<Tf k="만 {나이}세" params={{ 나이: age }} />)</>}
                    {' · '}<T k={genderText(p.gender, '성별 미상')} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </PrintDoc>
  );
}
