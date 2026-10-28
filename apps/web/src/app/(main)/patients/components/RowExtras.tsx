'use client';

/**
 * 환자 목록 행 덧붙임 표시(2026-10-20 환자 목록 P3 · `patients-list-refinement-2026-10.plan.md` B2·B3·B4·B5).
 *  - 나이: shared `ageOf`(만 나이) · 생년월일 모르면 그리지 않는다
 *  - 알레르기: 서버 4상태 그대로(`allergyStatusMeta`) · 🔴 미확인은 주의(회색 아님) · 초록은 문진 기록이 있을 때만 ·
 *    칸이 없으면(권한 밖) 아무것도 그리지 않는다(화면이 "없음"을 지어내지 않는다)
 *  - 최근 방문: 서명된 진료만 · 없으면 `-`(기록이 없다는 사실) · 칸 자체가 없으면(옛 서버) `?`
 *  - 머무는 곳: 재원 병동·호실 / 응급 진행 — 구역 단위 위치는 상황판·3D 몫
 */
import { ageOf, allergyStatusMeta, allergyStatusIsReassuring } from '@hospital-run/shared';
import { KDate, Unit } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

export type Stay = { kind: 'ADMITTED'; ward: string | null; room: string | null; bed: string | null } | { kind: 'ER'; status: string } | null;

export function AgeText({ dateOfBirth }: { dateOfBirth?: string | null }) {
  const age = ageOf(dateOfBirth ?? null);
  if (age == null) return null;
  return <span className="ml-1 text-gray-400" data-age><Tf k="만 {나이}세" params={{ 나이: age }} /></span>;
}

const TONE: Record<'danger' | 'warn' | 'safe', string> = {
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  safe: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function AllergyChip({ status, assessedAt }: { status?: string; assessedAt?: string | null }) {
  const tA = useTAttr();
  if (status === undefined) return null; // 권한 밖 — 칸 없음
  const meta = allergyStatusMeta(status);
  // 🔴 초록은 문진 기록이 있을 때만 — 그 밖의 "없음"은 주의로
  const tone = meta.tone === 'safe' && !allergyStatusIsReassuring(status, assessedAt) ? 'warn' : meta.tone;
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${TONE[tone]}`} title={tA(meta.meaning)} data-allergy={status}>
      <T k={meta.label} />
    </span>
  );
}

export function VisitCell({ lastVisitAt, nextAppointment }: { lastVisitAt?: string | null; nextAppointment?: { at: string; department: string | null } | null }) {
  return (
    <div className="space-y-0.5 text-xs whitespace-nowrap" data-visit>
      <p className="text-gray-500">
        <span className="text-[10px] text-gray-400"><T k="최근" /> </span>
        {lastVisitAt === undefined ? '?' : lastVisitAt ? <KDate value={lastVisitAt} /> : <span data-visit-none>-</span>}
      </p>
      {nextAppointment && (
        <p className="text-blue-700" data-next-appt>
          <span className="text-[10px] text-blue-400"><T k="다음" /> </span>
          <KDate value={nextAppointment.at} mode="datetime" />
          {nextAppointment.department && <span className="ml-1 text-[10px] text-blue-400">{nextAppointment.department}</span>}
        </p>
      )}
    </div>
  );
}

export function StayChip({ stay }: { stay?: Stay }) {
  if (!stay) return null;
  if (stay.kind === 'ADMITTED') {
    const where = [stay.ward, stay.room ? `${stay.room}${stay.bed ? `-${stay.bed}` : ''}` : null].filter(Boolean).join(' ');
    return (
      <span className="whitespace-nowrap rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700" data-stay="ADMITTED">
        <T k="재원" />{where && <> · {where}</>}
      </span>
    );
  }
  return <span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700" data-stay="ER"><T k="응급 진행" /></span>;
}

export { Unit };
