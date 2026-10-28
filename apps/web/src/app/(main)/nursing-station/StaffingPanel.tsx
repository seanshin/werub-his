'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { normalizeRosterWardDepartments, ROSTER_WARD_DEPARTMENTS_KEY, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { KDate, Num } from '@/components/ui/display';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';
import { SHIFT_KEY, type Staffing, type RosterNurse, type Assignee } from './board-types';

const ROSTER_FOLD = 6;

function Avatar({ name, tone }: { name: string; tone: string }) {
  return <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tone}`} aria-hidden="true">{name.trim().charAt(0) || '?'}</span>;
}

/** 근무표 날짜 문자열(@db.Date) — 날짜만 비교한다 */
const dayKey = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

function RosterList({ roster, highlight, tone, showToAck }: { roster: RosterNurse[]; highlight: Set<string>; tone: string; showToAck?: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open ? roster : roster.slice(0, ROSTER_FOLD);
  return (
    <>
      <ul className="space-y-1">
        {shown.map((n) => (
          <li key={n.userId} className="flex items-center gap-2 text-xs">
            <Avatar name={n.name} tone={tone} />
            <span className={`truncate ${highlight.has(n.userId) ? 'font-semibold text-gray-900' : 'text-gray-700'}`}><Data>{n.name}</Data></span>
            <span className="truncate text-[10px] text-gray-400"><Data>{n.department}</Data></span>
            {showToAck && n.handoffsToAck > 0 && (
              <span className="ml-auto shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"><Tf k="받을 인계 미확인 {수}" params={{ 수: n.handoffsToAck }} /></span>
            )}
          </li>
        ))}
      </ul>
      {roster.length > ROSTER_FOLD && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[11px] text-indigo-700 hover:underline">
          {open ? <T k="접기" /> : <Tf k="외 {수}명 더 보기" params={{ 수: roster.length - ROSTER_FOLD }} />}
        </button>
      )}
    </>
  );
}

/** 근무표가 비었을 때 — "근무자 없음"이 아니라 "근무표에 없음" · 근무표가 그 날짜까지 입력돼 있지 않으면 그 사실을 */
function RosterEmpty({ date, latest }: { date: string; latest: string | null }) {
  const stale = !latest || (dayKey(latest) ?? '') < (dayKey(date) ?? '');
  return (
    <p className="text-[11px] text-gray-500">
      <T k="근무표에 이 근무조 간호사가 없습니다." />
      {stale && (latest
        ? <> <T k="근무표 마지막 입력일" />: <KDate value={latest} mode="date" /></>
        : <> <T k="근무표가 입력돼 있지 않습니다." /></>)}
    </p>
  );
}

/**
 * 상·하번 간호사 — 하번 = 이번 근무조(인계하는 쪽) · 상번 = 다음 근무조(인수하는 쪽).
 *  · 하번 담당자는 **배정 원장**(이 보드 병동의 해제 안 된 배정)에서 — 병동이 정확하다
 *  · 근무표(하번·상번)는 **병원 전체** — 근무표 부서와 병동을 잇는 정본이 없어 짝짓지 않는다(그 사실을 말한다)
 */
/**
 * 근무표 부서 ↔ 병동 연결 편집(관리자 · 고른 병동 하나) — config `nursing.roster.wardDepartments` 를 읽어 그 병동 칸만 바꿔 쓴다.
 * 🔴 이름이 비슷하다고 자동으로 짝짓지 않는다 — 사람이 고른 것만 쓴다
 */
function WardDeptEditor({ wardId, wardName, options, current, queryKey, onClose }: {
  wardId: string; wardName: string; options: string[]; current: string[]; queryKey: unknown[]; onClose: () => void;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string[]>(current);
  // 호출 자리 게이트 — 설정 변경은 관리자만(서버 PUT config @Roles ADMIN)
  const isAdminUser = useHasRole();
  const save = useMutation({
    mutationFn: async () => {
      if (!isAdminUser) throw new Error(tAttr('근무표 부서 연결은 관리자만 바꿀 수 있습니다.'));
      const cur = await apiClient.get<{ data: unknown }>(`/api/v1/config/${ROSTER_WARD_DEPARTMENTS_KEY}`);
      const map = { ...(normalizeRosterWardDepartments(cur.data) ?? {}) };
      if (picked.length) map[wardId] = picked; else delete map[wardId];
      return apiClient.put(`/api/v1/config/${ROSTER_WARD_DEPARTMENTS_KEY}`, { value: Object.keys(map).length ? map : null });
    },
    onSuccess: () => { toast.success(tAttr('근무표 부서 연결을 저장했습니다.')); qc.invalidateQueries({ queryKey }); onClose(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('근무표 부서 연결을 저장하지 못했습니다.')),
  });
  return (
    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3" role="region" aria-label={tAttr('근무표 부서 연결')}>
      <p className="mb-2 text-xs font-semibold text-gray-800"><Tf k="{병동}에 연결할 근무표 부서" params={{ 병동: wardName }} /></p>
      {options.length === 0 ? (
        <p className="text-[11px] text-gray-500"><T k="근무표에 간호 부서가 없어 고를 수 없습니다." /></p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((d) => (
            <label key={d} className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-xs ${picked.includes(d) ? 'border-sky-400 bg-sky-50 text-sky-900' : 'border-gray-200 bg-white text-gray-700'}`}>
              <input type="checkbox" checked={picked.includes(d)} onChange={() => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))} className="h-3.5 w-3.5" />
              <Data>{d}</Data>
            </label>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
          className="min-h-[32px] rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {save.isPending ? <T k="저장 중..." /> : <T k="저장" />}
        </button>
        <button type="button" onClick={onClose} className="min-h-[32px] rounded-lg px-2 text-xs text-gray-600 hover:bg-white"><T k="취소" /></button>
        <span className="ml-auto self-center text-[10px] text-gray-400"><T k="아무것도 고르지 않고 저장하면 연결을 지웁니다." /></span>
      </div>
    </div>
  );
}

/**
 * ⑨ 간호사 1인당 환자 — 두 기준을 **갈라서**(합치지 않는다) 분모와 함께.
 *  · 배정 기준 = 보드 재원 환자 ÷ 이 보드에 담당 배정된 간호사(병동이 정확)
 *  · 근무표 기준 = 재원 환자 ÷ 이번 근무조 근무표 간호사 — 근무표가 **이 병동으로 연결됐을 때만**(병원 전체 근무표로 나누면 거짓 비율)
 *  · 분모 0·연결 없음 = 정본 RATIO_UNAVAILABLE + 이유(0 이나 '-' 로 접지 않는다) · 인력 기준(법정·원내)은 판정하지 않는다
 */
function StaffingRatio({ staffing, census }: { staffing: Staffing; census: { total: number; unassigned: number | null } }) {
  const byAssign = staffing.assignees.length;
  const byRoster = staffing.rosterScope === 'WARD' ? staffing.current.roster.length : null;
  const ratio = (d: number) => <Num value={census.total / d} domain="patientsPerNurse" />;
  return (
    <div className="border-t border-gray-100 px-4 py-2.5" data-staffing-ratio>
      <p className="mb-1 text-[10px] font-semibold text-gray-400"><T k="간호사 1인당 환자" /></p>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
          <dt className="text-[10px] text-gray-400"><T k="배정 기준" /></dt>
          <dd>{byAssign > 0
            ? <><span className="text-base font-bold text-gray-900">{ratio(byAssign)}</span> <span className="text-[10px] text-gray-500"><Tf k="재원 {환자}명 ÷ 담당 {간호사}명" params={{ 환자: census.total, 간호사: byAssign }} /></span></>
            : <span className="text-[11px] text-gray-500"><T k={RATIO_UNAVAILABLE} /> — <T k="담당 배정 없음" /></span>}</dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
          <dt className="text-[10px] text-gray-400"><T k="근무표 기준" /></dt>
          <dd>{byRoster == null
            ? <span className="text-[11px] text-gray-500"><T k={RATIO_UNAVAILABLE} /> — <T k="이 병동 근무표 연결 없음" /></span>
            : byRoster > 0
              ? <><span className="text-base font-bold text-gray-900">{ratio(byRoster)}</span> <span className="text-[10px] text-gray-500"><Tf k="재원 {환자}명 ÷ 근무 {간호사}명" params={{ 환자: census.total, 간호사: byRoster }} /></span></>
              : <span className="text-[11px] text-gray-500"><T k={RATIO_UNAVAILABLE} /> — <T k="근무표에 이 근무조 간호사 없음" /></span>}</dd>
        </div>
      </dl>
      {census.unassigned != null && census.unassigned > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-700"><Tf k="담당 없는 재원 환자 {수}명" params={{ 수: census.unassigned }} /></p>
      )}
      <p className="mt-1 text-[10px] text-gray-400"><T k="인력 기준 충족 여부는 판정하지 않습니다." /></p>
    </div>
  );
}

export function StaffingPanel({ staffing, ward, isAdmin = false, queryKey = [], census }: {
  staffing: Staffing | undefined; ward?: { id: string; name: string } | null; isAdmin?: boolean; queryKey?: unknown[];
  census?: { total: number; unassigned: number | null };
}) {
  const [editing, setEditing] = useState(false);
  const tAttr = useTAttr();
  if (!staffing) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <T k="이 서버 응답에는 근무 간호사 정보가 없습니다." />
      </section>
    );
  }
  const { current, next, assignees, rosterLatestDate } = staffing;
  const wardScoped = staffing.rosterScope === 'WARD';
  const rosterLabel = wardScoped ? <T k="근무표(이 병동)" /> : <T k="근무표(병원 전체)" />;
  const assigneeIds = new Set(assignees.map((a) => a.userId));

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden" aria-label={tAttr('상·하번 간호사')}>
      <header className="border-b border-gray-100 bg-gradient-to-r from-sky-50 to-white px-4 py-3">
        <h2 className="text-sm font-bold text-gray-900"><T k="상·하번 간호사" /></h2>
        <p className="mt-0.5 text-[11px] text-gray-500"><T k="하번 = 이번 근무조(인계) · 상번 = 다음 근무조(인수)" /></p>
      </header>

      <div className="grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y 2xl:grid-cols-2 2xl:divide-x 2xl:divide-y-0">
        {/* 하번 */}
        <div className="p-3.5" data-staffing="off">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="rounded-md bg-gray-800 px-1.5 py-0.5 text-[10px] font-bold text-white"><T k="하번" /></span>
            <span className="text-xs font-semibold text-gray-800"><T k={SHIFT_KEY[current.shift]} /></span>
            <span className="text-[10px] text-gray-400"><KDate value={current.date} mode="monthDay" /></span>
          </div>

          <p className="mb-1 text-[10px] font-semibold text-gray-400"><T k="이 병동 담당(배정)" /></p>
          {assignees.length === 0 ? (
            <p className="mb-2 text-[11px] text-gray-500"><T k="이 보드의 환자에 담당 배정된 간호사가 없습니다." /></p>
          ) : (
            <ul className="mb-2.5 space-y-1.5">
              {assignees.map((a: Assignee) => (
                <li key={a.userId} className="flex items-center gap-2">
                  <Avatar name={a.name} tone="bg-gray-800 text-white" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-gray-900"><Data>{a.name}</Data></p>
                    <p className="text-[10px] text-gray-500">
                      <Tf k="담당 {수}명" params={{ 수: a.patients }} /> · <Tf k="남긴 인계 {수}" params={{ 수: a.handoffsWritten }} />
                      {a.handoffsUnacked > 0 && <span className="text-rose-600"> · <Tf k="상대 미확인 {수}" params={{ 수: a.handoffsUnacked }} /></span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mb-1 text-[10px] font-semibold text-gray-400">{rosterLabel}</p>
          {current.roster.length === 0
            ? <RosterEmpty date={current.date} latest={rosterLatestDate} />
            : <RosterList roster={current.roster} highlight={assigneeIds} tone="bg-gray-200 text-gray-700" />}
        </div>

        {/* 상번 */}
        <div className="p-3.5" data-staffing="on">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="rounded-md bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white"><T k="상번" /></span>
            <span className="text-xs font-semibold text-gray-800"><T k={SHIFT_KEY[next.shift]} /></span>
            <span className="text-[10px] text-gray-400"><KDate value={next.date} mode="monthDay" /></span>
          </div>
          <p className="mb-1 text-[10px] font-semibold text-gray-400">{rosterLabel}</p>
          {next.roster.length === 0
            ? <RosterEmpty date={next.date} latest={rosterLatestDate} />
            : <RosterList roster={next.roster} highlight={new Set()} tone="bg-sky-100 text-sky-800" showToAck />}
        </div>
      </div>

      {census && census.total > 0 && <StaffingRatio staffing={staffing} census={census} />}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-2 text-[10px] text-gray-500" data-roster-scope={staffing.rosterScope}>
        {wardScoped ? (
          <span><T k="이 병동에 연결된 근무표 부서" />: <Data>{(staffing.wardDepartments ?? []).join(', ')}</Data></span>
        ) : staffing.wardUnmapped ? (
          <span className="text-amber-700"><T k="이 병동은 근무표 부서가 연결돼 있지 않아 근무표를 병원 전체로 보입니다." /></span>
        ) : (
          <span><T k="근무표 부서와 병동을 잇는 기준이 없어 근무표는 병원 전체를 부서와 함께 보입니다." /></span>
        )}
        {isAdmin && ward && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto font-medium text-sky-700 hover:underline"><T k="근무표 부서 연결" /></button>
        )}
        {!ward && <span className="ml-auto text-gray-400"><T k="병동을 고르면 그 병동의 근무표 부서 연결을 씁니다." /></span>}
      </div>
      {isAdmin && ward && editing && (
        <WardDeptEditor wardId={ward.id} wardName={ward.name} options={staffing.rosterDepartments ?? []} current={staffing.wardDepartments ?? []} queryKey={queryKey} onClose={() => setEditing(false)} />
      )}
    </section>
  );
}
