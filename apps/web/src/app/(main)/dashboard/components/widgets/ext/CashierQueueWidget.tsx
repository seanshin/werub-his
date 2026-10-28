'use client';
import Link from 'next/link';
import ApiWidget from '../ApiWidget';
import { asArray } from './RowListWidget';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { Duration, KDate, Money, PatientName, Unit } from '@/components/ui/display';

/**
 * 수납 대기열 — `GET /api/v1/billing/cashier-queue`(PENDING · 오래된 순).
 *
 * 🔴 (2026-10-02 실화면) 종전엔 **금액과 "대기"만** 그렸다 — 누구의 몇 시 진료인지, 얼마나 기다렸는지가 없어 수납 창구가
 *    이 목록으로 할 수 있는 일이 없었다. 주석은 "환자명 미포함"이라 했지만 서버는 환자·등록번호·진료과·담당의를 이미 내려주고
 *    있었다(위젯이 버렸다). 또 80건 중 8건만 그리면서 잘랐다는 말이 없었다.
 *    → 오늘 발생분(창구 앞 대기)과 이전 발생분(미수 추적)을 가르고, 행마다 환자·진료과·본인부담·경과를 말한다.
 *       행을 누르면 그 건의 수납 창이 열린다. 몇 건 중 몇 건을 보였는지 밝힌다.
 */
interface QueueItem {
  id: string;
  status: string;
  createdAt: string;
  patientCopay?: number | null;
  totalAmount?: number | null;
  patient?: { mrn?: string | null; familyName?: string | null; givenName?: string | null } | null;
  encounter?: { doctor?: { familyName?: string | null; givenName?: string | null; department?: string | null } | null } | null;
}

const TODAY_ROWS = 6;
const EARLIER_ROWS = 3;
const kstDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

function QueueRow({ it, now, today }: { it: QueueItem; now: number; today: boolean }) {
  const tt = useTAttr();
  const created = new Date(it.createdAt).getTime();
  const doctor = it.encounter?.doctor;
  const doctorName = `${doctor?.familyName ?? ''}${doctor?.givenName ?? ''}`;
  return (
    // 열 폭을 고정한다 — 금액·경과 열이 내용 길이로 늘면 행마다 진료과 칸이 어긋났다(실화면)
    <Link href={`/billing?billingId=${it.id}`} data-cashier-row={it.id}
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6.5rem_6.5rem] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <PatientName familyName={it.patient?.familyName} givenName={it.patient?.givenName} mrn={it.patient?.mrn} maskable className="truncate font-medium text-gray-800" />
      <span className="truncate text-gray-500">
        {doctor?.department ?? <T k="진료과 미상" />}{doctorName ? ` · ${doctorName}` : ''}
      </span>
      {/* 본인부담이 산정되지 않은 건을 0원으로 말하지 않는다 */}
      <Money value={it.patientCopay} fallback={tt('산정 전')} className="text-right font-semibold tabular-nums text-gray-900" />
      <span className="text-right text-[11px] text-gray-500 tabular-nums">
        {today
          ? <Duration minutes={Math.max(0, Math.floor((now - created) / 60000))} dense />
          : <><KDate value={it.createdAt} mode="monthDay" /> <span className="text-amber-700">{Math.floor((now - created) / 86400000)}<Unit>일째</Unit></span></>}
      </span>
    </Link>
  );
}

export default function CashierQueueWidget() {
  return <ApiWidget widgetId="cashier-queue" endpoint="/api/v1/billing/cashier-queue" refetchInterval={30000} emptyMessage="수납 대기 없음" render={(data) => {
    const all = asArray(data) as QueueItem[];
    if (!all.length) return <p className="text-xs text-gray-400"><T k="수납 대기 없음" /></p>;
    const nowDate = new Date();
    const now = nowDate.getTime();
    const todayKey = kstDay(nowDate);
    const todays = all.filter((it) => kstDay(new Date(it.createdAt)) === todayKey);
    const earlier = all.filter((it) => kstDay(new Date(it.createdAt)) !== todayKey);
    const shownToday = todays.slice(0, TODAY_ROWS);
    // 오늘 건이 적으면 이전 발생분을 더 보인다(빈 칸을 남기지 않되, 섹션은 섞지 않는다)
    const shownEarlier = earlier.slice(0, EARLIER_ROWS + Math.max(0, TODAY_ROWS - shownToday.length));
    const shown = shownToday.length + shownEarlier.length;
    return (
      <div className="flex h-full flex-col text-xs">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-gray-900"><T k="대기" /> <b className="text-base tabular-nums">{all.length}</b><Unit>건</Unit></span>
          <span className="text-gray-500"><T k="오늘 발생" /> {todays.length}<Unit>건</Unit></span>
          <span className={earlier.length ? 'text-amber-700' : 'text-gray-500'}><T k="이전 발생(미수 추적)" /> {earlier.length}<Unit>건</Unit></span>
        </div>

        <p className="px-2 pb-1 text-[11px] font-semibold text-gray-500"><T k="오늘 — 창구 대기(오래 기다린 순)" /></p>
        {shownToday.length
          ? shownToday.map((it) => <QueueRow key={it.id} it={it} now={now} today />)
          : <p className="px-2 pb-1 text-gray-400"><T k="오늘 발생한 수납 대기 없음" /></p>}

        {shownEarlier.length > 0 && (
          <>
            <p className="mt-2 border-t border-gray-100 px-2 pb-1 pt-2 text-[11px] font-semibold text-amber-700"><T k="이전 발생 — 아직 수납되지 않음(오래된 순)" /></p>
            {shownEarlier.map((it) => <QueueRow key={it.id} it={it} now={now} today={false} />)}
          </>
        )}

        <div className="mt-auto flex items-center justify-between pt-2 text-[11px]">
          <span className="text-gray-400">{shown < all.length ? <Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: all.length, 표시: shown }} /> : <T k="전부 표시" />}</span>
          <Link href="/billing" className="text-blue-600 hover:underline"><T k="수납 화면" /></Link>
        </div>
      </div>
    );
  }} />;
}
