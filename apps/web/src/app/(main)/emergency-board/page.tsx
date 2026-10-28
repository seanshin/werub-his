'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/stores/toast-store';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import GoldenPathwayPanel from './GoldenPathwayPanel';
import { pollMs } from '@/lib/ui-settings';
import { EMERGENCY_VISIT_STATUS_LABEL } from '@hospital-run/shared';
import { KTAS_LEVEL_LABEL, KTAS_SOLID, KTAS_BADGE } from '@/lib/ktas';

import { EmptyState, genderText, useDurationText } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

type Visit = {
  id: string; patientId: string; name: string; mrn: string; ktas: string; status: string;
  chiefComplaint: string; arrivalAt: string; losMins: number; disposition: string | null; boarding: boolean;
  bed?: string | null;
};
type Resp = {
  summary: { active: number; ktas: Record<string, number>; longStay: number; pendingTriage: number; boarding: number };
  visits: Visit[];
  bedSummary?: { zone: string; total: number; occupied: number; cleaning: number }[];
};

// KTAS 표시 정본(D7) — 라벨 shared·색 lib/ktas.ts 단일화(문자열 1:1 동일 확인 후 치환)
const KTAS = (['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5'] as const)
  .map((key) => ({ key, label: KTAS_LEVEL_LABEL[key], tone: KTAS_SOLID[key] }));
const KTAS_NUM: Record<string, string> = { LEVEL_1: 'KTAS 1', LEVEL_2: 'KTAS 2', LEVEL_3: 'KTAS 3', LEVEL_4: 'KTAS 4', LEVEL_5: 'KTAS 5' };
// 값은 i18n 키(`<T k={DISP_LABEL[…]}>`) — `사망` 은 무문맥이 차트 '사망(Deceased)'이라 처분 문맥 키로
const DISP_LABEL: Record<string, string> = { ADMISSION: '입원', DISCHARGE: '귀가', TRANSFER: '전원', OBSERVATION: '관찰', SURGERY: '수술', DEATH: '사망@처분', LEAVE_AMA: '자의퇴원' };
// 표시 정본은 `useDurationText()` — ER 체류가 하루를 넘으면 일로 읽혀야 하고 단위어는 UI 언어를 따른다

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone ?? 'border-gray-100 bg-white'}`}>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5"><T k={label} /></div>
    </div>
  );
}

export default function EmergencyBoard() {
  const los = useDurationText();
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['emergency-board'],
    queryFn: () => apiClient.get<{ data: Resp }>('/api/v1/emergency/board'),
    refetchInterval: pollMs('normal'),
  });
  const r = data?.data;
  const s = r?.summary;
  const visits = r?.visits ?? [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="응급실 보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="재실 환자 KTAS 분포·체류시간·입원대기(boarding) 실시간" /></p>
        </div>
        <FreshnessBadge updatedAt={dataUpdatedAt} isFetching={isFetching} staleMs={35000} />
      </div>

      <MciBanner />

      {/* KTAS 분포 */}
      <div className="grid grid-cols-5 gap-2">
        {KTAS.map((k) => (
          <div key={k.key} className={`rounded-2xl p-3 text-center ${k.tone}`}>
            <div className="text-2xl font-bold">{s?.ktas?.[k.key] ?? 0}</div>
            <div className="text-[11px] mt-0.5 opacity-90"><T k={k.label} /></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat label="재실 환자" value={s?.active ?? 0} />
        <Stat label="분류 대기" value={s?.pendingTriage ?? 0} tone="border-amber-200 bg-amber-50" />
        <Stat label="입원 대기(boarding)" value={s?.boarding ?? 0} tone="border-violet-200 bg-violet-50" />
        <Stat label="장기 체류(6h+)" value={s?.longStay ?? 0} tone="border-rose-200 bg-rose-50" />
      </div>

      {/* 구역 점유(ER 베드 보드 P1) — 베드 보드와 같은 정본(ward.type=EMERGENCY) */}
      {(r?.bedSummary?.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-gray-500"><T k="구역 점유" /></p>
            <Link href="/emergency" className="text-[11px] text-blue-600 hover:underline"><T k="베드 보드" /> →</Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
            {['RESUS', 'ACUTE', 'GEN', 'ISO', 'OBS'].map((zone) => {
              const z = r?.bedSummary?.find((x) => x.zone === zone);
              if (!z) return null;
              const label = { RESUS: '소생', ACUTE: '중증', GEN: '일반', ISO: '격리', OBS: '관찰' }[zone];
              const full = z.occupied >= z.total;
              return (
                <div key={zone} className={`rounded-xl px-3 py-2 border ${full ? 'border-rose-200 bg-rose-50' : 'border-gray-100 bg-gray-50'}`}>
                  <p className={`text-lg font-bold tabular-nums leading-tight ${full ? 'text-rose-600' : 'text-gray-900'}`}>{z.occupied}/{z.total}</p>
                  <p className="text-[10px] text-gray-500"><T k={label ?? ''} /> {z.cleaning > 0 && <span className="text-amber-600">🧹{z.cleaning}</span>}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-4">
        <NedocsCard />
        <PrenotifyPanel />
      </div>

      <GoldenPathwayPanel />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        /* 🔴 조회 실패를 "재실 환자가 없습니다"로 그리지 않는다 — 응급실 재실 0 은 그 자체가 판단 근거다 */
        : isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} />
        : !visits.length ? <EmptyState icon="👤" title="재실 환자가 없습니다." />
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
                <th className="px-4 py-2 font-medium">KTAS</th>
                <th className="px-3 py-2 font-medium"><T k="베드" /></th>
                <th className="px-3 py-2 font-medium"><T k="환자" /></th>
                <th className="px-3 py-2 font-medium"><T k="주증상" /></th>
                <th className="px-3 py-2 font-medium"><T k="상태" /></th>
                <th className="px-3 py-2 font-medium"><T k="체류" /></th>
                <th className="px-3 py-2 font-medium"><T k="처치결정" /></th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id} className={`border-b border-gray-50 hover:bg-gray-50/60 ${v.ktas === 'LEVEL_1' || v.ktas === 'LEVEL_2' ? 'bg-rose-50/40' : ''}`}>
                  <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${KTAS_BADGE[v.ktas] ?? 'bg-gray-100'}`}>{KTAS_NUM[v.ktas] ?? v.ktas}</span></td>
                  <td className="px-3 py-2.5">
                    {v.bed ? <span className="text-[11px] font-mono font-semibold text-gray-700">{v.bed}</span> : <span className="text-[11px] text-orange-400 font-medium"><T k="미배정" /></span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/patients/${v.patientId}`} className="font-medium text-blue-700 hover:underline">{v.name}</Link>
                    <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{v.mrn}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 max-w-[220px] truncate" title={v.chiefComplaint}>{v.chiefComplaint}</td>
                  <td className="px-3 py-2.5 text-gray-600"><T k={EMERGENCY_VISIT_STATUS_LABEL[v.status] ?? v.status} /></td>
                  <td className="px-3 py-2.5"><span className={v.losMins >= 360 ? 'text-rose-600 font-semibold' : 'text-gray-600'}>{los(v.losMins)}</span></td>
                  <td className="px-3 py-2.5">
                    {v.disposition
                      ? <span className={`text-[11px] px-2 py-0.5 rounded-full ${v.boarding ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>{v.boarding
                          ? <Tf k="{처분} 대기" params={{ 처분: <T k={DISP_LABEL[v.disposition] ?? v.disposition} /> }} />
                          : <T k={DISP_LABEL[v.disposition] ?? v.disposition} />}</span>
                      : <span className="text-gray-300">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ══════════ ER 잔여 3종 패널 (2026-07-23) ══════════ */

// ── NEDOCS 과밀도 지수 ──
interface Nedocs {
  score: number; grade: number; label: string; tone: 'ok' | 'warn' | 'danger';
  inputs: { patients: number; edBeds: number; boarding: number; ventilated: number; longestAdmitHours: number; longestWaitHours: number };
}
const NEDOCS_TONE: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-rose-300 bg-rose-50 text-rose-700',
};

function NedocsCard() {
  const fmtDur = useDurationText();
  const { data } = useQuery({
    queryKey: ['er-nedocs'],
    queryFn: () => apiClient.get<{ data: Nedocs }>('/api/v1/emergency/nedocs'),
    refetchInterval: pollMs('normal'),
  });
  const n = data?.data;
  if (!n) return null;
  const pct = Math.min(100, Math.round((n.score / 200) * 100));
  return (
    <div className={`rounded-2xl border p-4 ${NEDOCS_TONE[n.tone]}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold"><T k="NEDOCS 과밀도" /></h3>
        <span className="text-[10px] opacity-70"><Tf k="등급 {등급}/6" params={{ 등급: n.grade }} /></span>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-3xl font-bold">{n.score}</span>
        <span className="text-sm font-semibold">{n.label}</span>
      </div>
      <div className="mt-2 h-2 bg-white/70 rounded-full overflow-hidden">
        <div className={`h-full ${n.tone === 'ok' ? 'bg-emerald-400' : n.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] mt-2 opacity-80">
        {/* 🔴 같은 화면 위 표는 `8시간 50분`인데 여기만 `8.8h` 였다 — 한 값이 두 표기로 보인다 */}
        {/* 🔴 한 문장 한 키 — 종전 JSX 줄바꿈이 `·` 앞 공백을 지웠다(`호흡기 1· 최장…`). ko 글자 동일성을 위해 그 모양 그대로 키로 둔다 */}
        <Tf k="재실 {재실}/{병상}병상 · 입원대기 {입원대기} · 호흡기 {호흡기}· 최장 입원대기 {최장입원}· 최장 대기 {최장대기}" params={{
          재실: n.inputs.patients, 병상: n.inputs.edBeds, 입원대기: n.inputs.boarding, 호흡기: n.inputs.ventilated,
          최장입원: fmtDur(Math.round((n.inputs.longestAdmitHours ?? 0) * 60), '0분'),
          최장대기: fmtDur(Math.round((n.inputs.longestWaitHours ?? 0) * 60), '0분'),
        }} />
      </p>
    </div>
  );
}

// ── 119/전원 사전통보(도착 예정) ──
interface Prenotify {
  id: string; source: string; unitId?: string | null; chiefComplaint: string; severityHint?: string | null;
  patientAge?: number | null; patientGender?: string | null; etaRemainingMins?: number | null;
}

function PrenotifyPanel() {
  const fmtDur = useDurationText();
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const { data } = useQuery({
    queryKey: ['er-prenotify'],
    queryFn: () => apiClient.get<{ data: Prenotify[] }>('/api/v1/emergency/prenotifications'),
    refetchInterval: pollMs('fast'),
  });
  const rows: Prenotify[] = Array.isArray(data?.data) ? data.data : [];
  const act = async (id: string, action: 'arrive' | 'cancel') => {
    try {
      await apiClient.patch(`/api/v1/emergency/prenotifications/${id}/${action}`, {});
      toast.success(tAttr(action === 'arrive' ? '도착 처리됐습니다 — 트리아지를 진행하세요.' : '통보가 취소되었습니다.'));
      qc.invalidateQueries({ queryKey: ['er-prenotify'] });
    } catch { toast.error(tAttr('처리에 실패했습니다.')); }
  };
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-blue-900">🚑 <T k="도착 예정 (119/전원 사전통보)" /></h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-blue-400 mt-3 text-center py-2"><T k="도착 예정 통보가 없습니다" /></p>
      ) : (
        <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
          {rows.map((r) => {
            const late = r.etaRemainingMins != null && r.etaRemainingMins < 0;
            return (
              <div key={r.id} className="bg-white rounded-xl px-3 py-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-gray-900 truncate">{r.chiefComplaint}</span>
                    {r.severityHint && <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">{r.severityHint}</span>}
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {r.source === 'EMS_119' ? '119' : <T k="전원" />}{r.unitId ? ` ${r.unitId}` : ''}
                    {r.patientAge != null ? <>{' · '}<Tf k="{나이}세" params={{ 나이: r.patientAge }} /></> : ''}{r.patientGender ? ` ${genderText(r.patientGender)}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-[11px] font-bold ${late ? 'text-rose-600' : 'text-blue-700'}`}>
                  {r.etaRemainingMins == null ? <T k="ETA 미상" /> : late
                    ? <Tf k="{시간} 지연" params={{ 시간: fmtDur(-r.etaRemainingMins) }} />
                    : <Tf k="{시간} 후" params={{ 시간: fmtDur(r.etaRemainingMins) }} />}
                </span>
                <button onClick={() => act(r.id, 'arrive')} className="shrink-0 px-2 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="도착" /></button>
                <button onClick={() => act(r.id, 'cancel')} className="shrink-0 px-1.5 py-1 text-[10px] text-gray-400 hover:text-gray-600"><T k="취소" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MCI(다수사상자/재난) 배너 ──
interface MciResp {
  active: boolean;
  event?: { id: string; title: string; type: string; expectedCasualties?: number | null; activatedAt: string };
  casualties?: { total: number; byKtas: Record<string, number>; inTreatment: number; admitted: number };
}

function MciBanner() {
  /** 🔴 MCI(다중사상자) 선포·해제는 서버가 `@Roles(ADMIN, DOCTOR)` — 재난 지휘 결정이다 */
  const canDeclare = useHasRole('DOCTOR');
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const { data } = useQuery({
    queryKey: ['er-mci'],
    queryFn: () => apiClient.get<{ data: MciResp }>('/api/v1/emergency/mci/active'),
    refetchInterval: pollMs('fast'),
  });
  const m = data?.data;

  const activate = async () => {
    const title = window.prompt(tAttr('MCI/재난 이벤트명(예: ○○ 다중 추돌사고)'));
    if (!title?.trim()) return;
    const expected = window.prompt(tAttr('예상 사상자 수(선택 — 숫자만)'));
    try {
      await apiClient.post('/api/v1/emergency/mci/activate', { title: title.trim(), expectedCasualties: expected ? Number(expected) : undefined });
      toast.success(tAttr('MCI가 활성화되었습니다 — 트리아지 후 사상자 태깅을 진행하세요.'));
      qc.invalidateQueries({ queryKey: ['er-mci'] });
    } catch (e: unknown) { toast.error((e as { message?: string })?.message || tAttr('MCI 활성화 실패')); }
  };
  const close = async () => {
    if (!m?.event || !window.confirm(tfAttr('MCI "{이벤트}"를 해제하시겠습니까?', { 이벤트: m.event.title }))) return;
    try {
      await apiClient.patch(`/api/v1/emergency/mci/${m.event.id}/close`, {});
      toast.success(tAttr('MCI가 해제되었습니다.'));
      qc.invalidateQueries({ queryKey: ['er-mci'] });
    } catch { toast.error(tAttr('해제 실패')); }
  };

  if (!m?.active) {
    return (
      <div className="flex justify-end">
        {canDeclare && <button onClick={activate} className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-600 hover:border-rose-300">
          🚨 <T k="MCI/재난 모드" />
        </button>}
      </div>
    );
  }
  const c = m.casualties;
  return (
    <div className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-4 animate-[pulse_3s_ease-in-out_infinite]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xl">🚨</span>
          <div>
            <p className="text-sm font-bold text-rose-800"><Tf k="MCI 활성 — {이벤트}" params={{ 이벤트: m.event?.title ?? '' }} /></p>
            <p className="text-[11px] text-rose-600">
              <Tf k="사상자 {수}명 등록" params={{ 수: c?.total ?? 0 }} />{m.event?.expectedCasualties ? <>{' / '}<Tf k="예상 {수}명" params={{ 수: m.event.expectedCasualties }} /></> : ''}
              · <Tf k="진료중 {진료중} · 입원 {입원}" params={{ 진료중: c?.inTreatment ?? 0, 입원: c?.admitted ?? 0 }} />
              {c?.byKtas && Object.keys(c.byKtas).length > 0 && ` · KTAS ${Object.entries(c.byKtas).map(([k, v]) => `${k.replace('LEVEL_', '')}:${v}`).join(' ')}`}
            </p>
          </div>
        </div>
        {canDeclare && <button onClick={close} className="px-3 py-1.5 text-xs font-medium bg-white text-rose-700 border border-rose-300 rounded-lg hover:bg-rose-100"><T k="해제" /></button>}
      </div>
    </div>
  );
}
