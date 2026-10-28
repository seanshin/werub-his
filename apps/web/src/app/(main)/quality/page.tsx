'use client';

import { T, useTfAttr, useTAttr } from '@/components/ui/i18n-text';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import MeasurementPanel from './MeasurementPanel';
import QiFlowPanel, { SourceBadge } from './QiFlowPanel';
import QiFlowOps, { settingValue, useQiFlowSettings } from './QiFlowOps';
import { QiSupplierCatalog } from './QiSupplierCatalog';
import { QI_PROPORTION_KINDS, QI_SUPPLIERS, QI_SUPPLIER_DEFINITION, type QiSupplierKey } from '@hospital-run/shared';
import { formatNum, ratioText } from '@hospital-run/shared';
import {
  DIRECTION_LABEL,
  SOURCE_LABEL,
  UNDETERMINED_LABEL,
  type QiIndicator,
} from './quality-types';

/**
 * 질 향상(QI) 지표 화면.
 *
 * 🔴 종전 결함(화면 실사용 점검 W7)
 *   1. 달성 판정을 화면이 다시 만들었다 — `latestValue <= target`(전 지표 '낮을수록 좋음').
 *      서버(`value >= target`)·seed(키워드)와 규칙이 셋이었고 방향이 서로 반대였다(P12).
 *      → 판정은 서버 정본(`quality/indicator-policy`)이 낸 `meetTarget` 을 **그대로** 쓴다.
 *   2. 단위를 서버가 보내지 않는데 `q.unit ?? '%'` 로 폴백해 25지표 전부에 `%` 를 붙였다 —
 *      평균 재원일수 목표 "7%"(일)·외래 초진 대기시간 "30%"(분)·환자 불만 "5%"(건).
 *      → 모르면 붙이지 않는다.
 *   3. '산식' 열이 존재하지도 않는 `unit` 을 그렸다(전 행 "%"). → '단위' 열로 정직화.
 *   4. 진행바가 `value/target*100` 이라 '낮을수록 좋은' 지표에서 반대로 찼다.
 *      → 서버가 방향을 반영해 계산한 `achievementPercent` 사용.
 *   5. 달성률 분모에 미측정 지표를 미달로 포함했다(달성+미달 ≠ 분모).
 *      → 판정된 지표만 분모. 미측정/판정불가는 따로 센다.
 *   6. 카테고리 색 키가 DB 실값과 어긋나 25개 중 13개가 무색이었다('감염 관리' vs '감염관리').
 *   7. 최신 측정이 몇 달 전인데 기준 시점 표기가 없어 "달성률 84%"가 현재로 읽혔다.
 *
 * 🔴 W7 이연분(2026-08-18) — **방향이 코드 등재표에만 있었다**
 *   8. 관리자가 새 지표를 만들면 방향 미등재라 측정 입력이 422 로 막혔고, 화면에는 **어디서 방향을
 *      등재하는지**가 없었다(풀려면 코드 배포가 필요했다). → 방향·단위·배율이 DB 컬럼이 됐고
 *      이 화면(ADMIN)에서 직접 등재한다. 측정은 방향을 몰라도 저장되며 '판정 불가'로 남는다.
 *      우선순위 정본은 서버 한 곳(`indicator-policy.ts` 상단): **DB 컬럼 → 코드 등재표 → 미등재**.
 *
 * 🔴 W7 이연분(2026-08-18) — **측정값을 넣을 화면이 없었다**
 *   9. `POST /api/v1/quality/measurements` 는 API 만 있고 **부르는 화면이 web·mobile 어디에도 없었다**
 *      (EP 를 만들면 부르는 화면까지가 한 벌). 지표를 등재해도 측정값을 넣을 방법이 없었고,
 *      `GET /quality/measurements/:id` 로 쌓인 이력도 화면에서 볼 수 없었다.
 *      → 행마다 [측정] 패널(`MeasurementPanel`)에서 기간·분자·분모를 입력하고 이력을 본다.
 *        적용 배율·단위를 화면이 밝히고, 분모 0 은 저장을 시도하지 않으며, 방향 미등재는 '판정 불가'로 남는다.
 */

/** DB 실값 기준(공백 제거해 비교) — 문서 표기('감염 관리')와 DB('감염관리')가 갈려도 같은 색이 되게 한다. */
const CATEGORY_COLOR: Record<string, string> = {
  환자안전: 'bg-red-50 text-red-700',
  진료성과: 'bg-blue-50 text-blue-700',
  진료효율: 'bg-amber-50 text-amber-700',
  감염관리: 'bg-purple-50 text-purple-700',
  경영: 'bg-emerald-50 text-emerald-700',
};
const categoryColor = (c: string) => CATEGORY_COLOR[(c ?? '').replace(/\s+/g, '')] ?? 'bg-gray-100 text-gray-600';

interface DraftIndicator {
  /** 결정 qi.indicator.directEdit — 정의·목표를 화면에서 바꾸는 사유 */
  changeReason: string;
  name: string;
  category: string;
  formula: string;
  targetValue: string;
  direction: string;
  unit: string;
  valueScale: string;
  /** 자동 산출 공급원(2026-10-10) — '' = 수기 지표(이름이 공급원 정의와 같으면 이름으로도 묶인다) */
  supplierKey: string;
}

const EMPTY_DRAFT: DraftIndicator = {
  changeReason: '', name: '', category: '', formula: '', targetValue: '', direction: '', unit: '', valueScale: '', supplierKey: '',
};

interface EditState {
  id: string;
  changeReason: string;
  direction: string; // '' = 등재 해제
  unit: string;
  valueScale: string;
  /** '' = 공급원 등재 해제(이름 정규형 매칭은 그대로) */
  supplierKey: string;
}

/**
 * 원내 원장 대조 근거.
 *
 * 🔴 2026-09-02 종단 검토: QI 측정값은 **사람이 넣는 수기 원장**이고 임상 사건 기록과 자동 대조되지
 *    않는다. 그런데 화면은 그 사실을 말하지 않아 "손위생 98.48% 달성"이 원내 관찰 기록에 근거한 것처럼
 *    읽혔다 — 같은 시점 손위생 관찰은 **0건**이었고 안전·질 보드는 '산출 불가'라고 말하고 있었다.
 *
 * 🔴 **수기 입력이 틀렸다고 단정하지 않는다**(종이 관찰 후 월 단위 입력은 정상적인 QI 운영이다).
 *    판정하지 않고 대조 근거를 나란히 놓는다 — 판단은 사람이 한다.
 */
function LedgerNote({ ledger }: { ledger?: { source: string; count: number; period?: string | null } | null }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  if (!ledger) return null; // 매핑 없는 지표에는 아무 말도 하지 않는다
  const empty = ledger.count === 0;
  // 🔴 2026-10-08 — 종전엔 전 기간 건수를 월 측정 옆에 붙였다. 이제 측정 달의 건수(측정이 없으면 전 기간)
  const scope = ledger.period ? tfAttr('{기간} 한 달', { 기간: ledger.period }) : tAttr('전 기간');
  return (
    <div
      className={`mt-1 text-[10px] leading-tight ${empty ? 'text-amber-600' : 'text-gray-400'}`}
      data-ledger-period={ledger.period ?? 'ALL'}
      title={
        empty
          ? tfAttr('{원장}이(가) {범위} 0건입니다. 위 수치는 수기 입력이며 원내 기록으로 대조되지 않았습니다.', { 원장: ledger.source, 범위: scope })
          : tfAttr('{원장} {범위} {n}건과 대조해 보십시오. 집계 기준(분모·포함 범위)이 다를 수 있습니다.', { 원장: ledger.source, 범위: scope, n: ledger.count })
      }
    >
      {empty ? `⚠ ${ledger.source} 0${tAttr('건')}(${scope}) — ${tAttr('수기 입력')}` : `${ledger.source} ${ledger.count}${tAttr('건')}(${scope})`}
    </div>
  );
}

export default function QualityPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  /**
   * 🔴 세 갈래로 다르다(서버 정본: `quality.controller.ts`) —
   *  · **지표 정의**(등록·방향/단위/배율/목표 수정) = ADMIN. 바꾸면 전 기간 판정이 뒤집힌다.
   *  · **측정 입력·정정** = `qi:measure:write`(기본 ADMIN·NURSE). 감염관리·환자안전 지표의
   *    산출 주체가 간호(감염관리실·환자안전 전담인력)라 그들이 못 넣으면 지표가 비어버린다.
   *  · **무효화** = `qi:measure:void`(기본 ADMIN). 입력자가 자기 입력을 집계에서 지울 수 없게.
   *
   * 🔴 이 화면은 **역할 기본 매트릭스**만 안다 — 관리자가 `/admin/rbac` 에서 오버라이드하면
   *    서버 판정과 갈릴 수 있다. 그래서 버튼을 숨기는 것으로 끝내지 않고, 서버가 거절하면
   *    그 메시지를 그대로 보여준다(화면이 두 번째 정본이 되지 않게).
   */
  const isAdmin = user?.role === 'ADMIN';
  const canMeasure = isAdmin || user?.role === 'NURSE';
  const canVoid = isAdmin;
  const [edit, setEdit] = useState<EditState | null>(null);
  /** 측정 입력·이력 패널이 열린 지표 id(한 번에 하나) */
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftIndicator>(EMPTY_DRAFT);
  // 결정 qi.indicator.directEdit — AGENDA_ONLY 면 정의·목표 직접 수정이 서버에서 409(화면은 미리 말한다)
  const flowSettings = useQiFlowSettings();
  const agendaOnly = settingValue(flowSettings.data, 'qi.indicator.directEdit') === 'AGENDA_ONLY';
  const reasonOk = (r: string) => r.trim().length >= 5;

  const { data: dashboard, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['qi-dashboard'],
    queryFn: () => apiClient.get<{ data: QiIndicator[] }>('/api/v1/quality/dashboard'),
  });

  const saveMut = useMutation({
    mutationFn: (p: EditState) =>
      apiClient.patch(`/api/v1/quality/indicators/${p.id}`, {
        changeReason: p.changeReason.trim(),
        direction: p.direction || null,
        unit: p.unit.trim() || null,
        valueScale: p.valueScale.trim() === '' ? null : Number(p.valueScale),
        supplierKey: p.supplierKey || null,
      }),
    onSuccess: () => {
      toast.success('지표 정의를 등재했습니다. 저장된 측정값은 읽는 시점에 새 방향으로 재판정됩니다.');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['qi-dashboard'] });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '등재 실패'),
  });

  const createMut = useMutation({
    mutationFn: (d: DraftIndicator) =>
      apiClient.post('/api/v1/quality/indicators', {
        changeReason: d.changeReason.trim(),
        name: d.name.trim(),
        category: d.category.trim(),
        formula: d.formula.trim(),
        targetValue: Number(d.targetValue),
        // 🔴 만들 때 방향을 함께 등재한다 — 비워 두면 판정 불가로 태어난다(막지는 않는다)
        direction: d.direction || null,
        unit: d.unit.trim() || null,
        valueScale: d.valueScale.trim() === '' ? null : Number(d.valueScale),
        supplierKey: d.supplierKey || null,
      }),
    onSuccess: () => {
      toast.success('지표를 등록했습니다.');
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      qc.invalidateQueries({ queryKey: ['qi-dashboard'] });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '등록 실패'),
  });

  const _raw = dashboard?.data;
  const indicators: QiIndicator[] = Array.isArray(_raw)
    ? _raw
    : ((_raw as unknown as Record<string, unknown>)?.data as QiIndicator[]) ?? [];

  // 집계 — 판정된 것만 달성률 분모에 넣는다(미측정·판정불가는 분모 밖).
  const total = indicators.length;
  const met = indicators.filter((i) => i.meetTarget === true).length;
  const below = indicators.filter((i) => i.meetTarget === false).length;
  const unmeasured = indicators.filter((i) => i.latestValue === null).length;
  const undetermined = indicators.filter((i) => i.latestValue !== null && i.meetTarget === null).length;
  const judged = met + below;
  // 🔴 판정된 지표가 없으면 달성률은 0% 도 100% 도 아니다 — '산출 불가'다(표본 부재 ≠ 0).
  const achieveRate = judged > 0 ? Math.round((met / judged) * 100) : null;
  /** 방향 미등재 지표 — 측정은 저장되지만 판정이 안 된다. 관리자가 여기서 등재한다. */
  const noDirection = indicators.filter((i) => i.direction === null);
  const conflicting = indicators.filter((i) => i.directionConflict);

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="질 향상 (QI)" /></h2>
          <p className="text-sm text-gray-500 mt-1">
            <T k="핵심 질 지표 대시보드 및 모니터링" />
            {asOfText(indicators)}
          </p>
        </div>
        {isAdmin && !agendaOnly && (
          <button
            type="button"
            className="text-xs px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 whitespace-nowrap"
            onClick={() => setCreating((v) => !v)}
          >
            <T k={creating ? '취소' : '+ 새 지표'} />
          </button>
        )}
      </div>

      {isAdmin && agendaOnly && (
        <p className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-800" data-qi-agenda-only>
          <T k="위원회 결정(qi.indicator.directEdit = 안건 경로만)에 따라 지표 등록·정의·목표 직접 수정이 닫혀 있습니다 — 목표는 행의 [측정] → '목표 안건'으로 위원회에 올립니다." />
        </p>
      )}

      <QiFlowOps />

      <QiSupplierCatalog
        indicators={indicators}
        canDraft={isAdmin && !agendaOnly}
        onDraft={(k) => {
          // 🔴 폼을 채울 뿐 등록하지 않는다 — 목표·방향·분류·사유는 사람이 정한다
          const d = QI_SUPPLIER_DEFINITION[k];
          const proportion = QI_PROPORTION_KINDS.has(QI_SUPPLIERS[k].kind);
          setDraft({ ...EMPTY_DRAFT, name: d?.name ?? k, formula: QI_SUPPLIERS[k].label, supplierKey: k, unit: proportion ? '%' : '', valueScale: proportion ? '100' : '' });
          setCreating(true);
          if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {isAdmin && creating && !agendaOnly && (
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-800 mb-3"><T k="새 질 지표 등록" /></p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-gray-600">
            <label>
              <span className="block mb-1"><T k="지표명" /></span>
              <input className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs"
                value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label>
              <span className="block mb-1"><T k="분류" /></span>
              <input className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" placeholder={tAttr('환자안전 · 감염관리 …')}
                value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            </label>
            <label>
              <span className="block mb-1"><T k="목표값" /></span>
              <input className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" inputMode="decimal"
                value={draft.targetValue} onChange={(e) => setDraft({ ...draft, targetValue: e.target.value })} />
            </label>
            <label className="md:col-span-3">
              <span className="block mb-1"><T k="산출공식" /></span>
              <input className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" placeholder={tAttr('(분자 / 분모) × 100')}
                value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value })} />
            </label>
            <label>
              <span className="block mb-1"><T k="지표 방향" /></span>
              <select className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
                value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value })}>
                <option value="">{tAttr('(등재 안 함 — 판정 불가)')}</option>
                <option value="LOWER_IS_BETTER">{tAttr('낮을수록 좋음')}</option>
                <option value="HIGHER_IS_BETTER">{tAttr('높을수록 좋음')}</option>
              </select>
            </label>
            <label>
              <span className="block mb-1"><T k="표시 단위" /></span>
              <input className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" placeholder={tAttr('% · 일 · 분 · 건')} maxLength={20}
                value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
            </label>
            <label>
              <span className="block mb-1"><T k="측정값 배율" /></span>
              <input className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" placeholder="100 / 1000 / 1" inputMode="numeric"
                value={draft.valueScale} onChange={(e) => setDraft({ ...draft, valueScale: e.target.value })} />
            </label>
            <label className="md:col-span-3">
              <span className="block mb-1"><T k="자동 산출 공급원(선택)" /></span>
              <SupplierSelect value={draft.supplierKey} onChange={(v) => setDraft({ ...draft, supplierKey: v })} />
            </label>
            <label className="md:col-span-3">
              <span className="block mb-1"><T k="등록 사유" /></span>
              <input className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" data-qi-change-reason="create"
                value={draft.changeReason} onChange={(e) => setDraft({ ...draft, changeReason: e.target.value })} />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={createMut.isPending || !draft.name.trim() || !draft.category.trim() || !draft.formula.trim() || draft.targetValue.trim() === '' || !reasonOk(draft.changeReason)}
              className="min-h-[44px] text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50"
              data-qi-create-submit
              onClick={() => createMut.mutate(draft)}
            >
              <T k="등록" />
            </button>
            <p className="text-[10px] text-gray-500">
              <T k="방향을 비워 두면 등록은 되지만 목표 달성은" /> <b><T k="판정 불가" /></b><T k="로 남습니다(측정 입력은 막지 않습니다). 단위·배율을 비우면 산출공식에서 읽고, 그래도 없으면 백분율(×100)로 가정합니다." />
            </p>
          </div>
        </div>
      )}

      {/* 🔴 방향 미등재 안내 — 종전에는 화면이 아무 말도 하지 않아 측정 입력이 왜 막히는지 알 수 없었다 */}
      {noDirection.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <b><T k="지표 방향 미등재" /> {noDirection.length}<T k="건" /></b> <T k="— 측정값은 저장되지만 목표 달성 여부는" />{' '}
          <b><T k="판정 불가" /></b><T k="로 남습니다(모르는 것을 달성/미달로 적지 않습니다)." />
{' '}
          <T k={isAdmin
            ? '아래 표의 [정의] 버튼에서 방향·단위·배율을 등재하십시오.'
            : '등재는 관리자(ADMIN)가 이 화면의 [정의] 버튼에서 합니다.'} />
          <span className="block mt-1 text-amber-700">
            {noDirection.map((i) => i.name).join(' · ')}
          </span>
        </div>
      )}
      {conflicting.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <b><T k="등재 방향이 코드 등재표와 반대인 지표" /> {conflicting.length}<T k="건" /></b> <T k="— 등재값(DB)을 따릅니다. 의도한 것이 아니면 정의를 확인하십시오:" /> {conflicting.map((i) => i.name).join(' · ')}
        </div>
      )}

      {/* 통계 카드 — 달성 + 미달 = 판정 완료. 미측정·판정불가는 따로 센다. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {[
          { label: '전체 지표', value: total, color: 'text-gray-900', bg: 'bg-white', note: '' },
          { label: '목표 달성', value: met, color: 'text-emerald-600', bg: 'bg-emerald-50/50', note: '' },
          { label: '미달', value: below, color: 'text-red-600', bg: 'bg-red-50/50', note: '' },
          {
            label: '미측정',
            value: undetermined > 0 ? `${unmeasured} (+판정불가 ${undetermined})` : unmeasured,
            color: 'text-gray-500',
            bg: 'bg-gray-50',
            note: '',
          },
          {
            label: '달성률',
            // 🔴 비율은 분모와 함께(§2.1) — 정본 ratioText: 판정 0이면 '산출 불가'
            value: ratioText(met, judged, { decimals: 0 }),
            color: 'text-blue-600',
            bg: 'bg-blue-50/50',
            note:
              achieveRate === null
                ? `판정된 지표 없음 (전체 ${total}지표)`
                : `판정 ${judged}/${total}지표 기준${asOf(indicators) ? ` · ${asOf(indicators)}` : ''}`,
          },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 shadow-sm p-4`}>
            <p className="text-[11px] font-medium text-gray-500 mb-1"><T k={s.label} /></p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            {s.note && <p className="text-[10px] text-gray-400 mt-0.5">{s.note}</p>}
          </div>
        ))}
      </div>

      {/* 지표 테이블 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="지표명" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="카테고리" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 w-[130px]"><T k="단위 · 방향" /></th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[80px]"><T k="목표" /></th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[110px]"><T k="현재값" /></th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[70px]"><T k="달성" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="기간" /></th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[120px]"><T k="측정 · 정의" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !indicators.length ? (
              <tr><td colSpan={8} className="py-16 text-center text-gray-400"><T k="등록된 질 지표가 없습니다" /></td></tr>
            ) : (
              indicators.map((q) => {
                const target = Number(q.targetValue);
                const unit = q.unit ?? ''; // 🔴 모르는 단위를 '%'로 지어내지 않는다
                const progress = q.achievementPercent; // 서버가 방향을 반영해 계산
                const editing = edit?.id === q.id;
                const panelOpen = measuring === q.id;
                return (
                  <Fragment key={q.id}>
                    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-medium text-gray-900">{q.name}</p>
                        {q.formula && <p className="text-[10px] text-gray-400 mt-0.5">{q.formula}</p>}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${categoryColor(q.category)}`}>
                          {q.category}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {q.unit ?? <span className="text-gray-300">-</span>}
                        {q.direction ? (
                          <span className="block text-[10px] text-gray-400">
                            <T k={DIRECTION_LABEL[q.direction]} />
                            {q.directionSource && (
                              <span className={`ml-1 ${q.directionSource === 'COLUMN' ? 'text-gray-400' : 'text-amber-600'}`}>
                                (<T k={SOURCE_LABEL[q.directionSource]} />)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="block text-[10px] text-amber-600"><T k="방향 미등재" /></span>
                        )}
                        {!q.valueScaleKnown && (
                          <span className="block text-[10px] text-amber-600" title={tAttr('산식·컬럼 어디에도 배율이 없어 백분율(×100)로 가정했습니다')}>
                            <T k="배율 가정 ×" />{q.valueScale}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center text-sm font-medium text-gray-700">{target}{unit && ` ${unit}`}</td>
                      <td className="px-5 py-4 text-center">
                        {q.latestValue !== null ? (
                          <div>
                            <span className={`text-sm font-bold ${q.meetTarget === true ? 'text-emerald-600' : q.meetTarget === false ? 'text-red-600' : 'text-gray-700'}`}>
                              {q.latestValue.toFixed(1)}{unit && ` ${unit}`}
                            </span>
                            <div className="mt-0.5"><SourceBadge source={q.latestSource} /></div>
                            {q.alternate && (
                              // 🔴 같은 달 수기·자동 값이 다르면 둘 다 보인다 — 어느 쪽이 정본인지는 위원회 결정
                              <p className="mt-0.5 text-[10px] text-gray-500" data-qi-alternate={q.alternate.source ?? ''}>
                                <T k="병기" /> {formatNum(q.alternate.value, 'qiValue')}{unit && ` ${unit}`} <SourceBadge source={q.alternate.source} />
                              </p>
                            )}
                            {progress !== null && (
                              <div className="mt-1 w-full bg-gray-100 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full ${q.meetTarget === true ? 'bg-emerald-400' : 'bg-red-400'}`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400"><T k="미측정" /></span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center">
                        {q.latestValue === null ? (
                          <span className="text-xs text-gray-300">-</span>
                        ) : q.meetTarget === null ? (
                          // 🔴 방향 미상 = '미달'이 아니다. 모르는 것을 빨간 미달로 적지 않는다.
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                            title={tAttr(UNDETERMINED_LABEL[q.undeterminedReason ?? 'DIRECTION_NOT_REGISTERED'])}
                          >
                            <T k="판정 불가" />
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${q.meetTarget ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            <T k={q.meetTarget ? '✓ 달성' : '✗ 미달'} />
                          </span>
                        )}
                        <LedgerNote ledger={q.ledger} />
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-400 font-mono">{q.latestPeriod ?? '-'}</td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* 🔴 측정값 입력·이력 — 종전에는 이 EP 를 부르는 화면이 아예 없었다 */}
                          <button
                            type="button"
                            className={`text-[11px] px-2 py-1 rounded-lg border ${panelOpen ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                            onClick={() => setMeasuring(panelOpen ? null : q.id)}
                          >
                            <T k={panelOpen ? '닫기' : '측정'} />
                          </button>
                          {isAdmin && !agendaOnly && (
                            <button
                              type="button"
                              className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                              onClick={() =>
                                setEdit(
                                  editing
                                    ? null
                                    : {
                                        id: q.id,
                                        changeReason: '',
                                        // 🔴 폼은 **등재된 원본**만 프리필한다 — 폴백값을 넣으면 등재된 적 없는 것이 등재된 것처럼 보인다
                                        direction: q.registeredDirection ?? '',
                                        unit: q.registeredUnit ?? '',
                                        valueScale: q.registeredValueScale === null ? '' : String(q.registeredValueScale),
                                        supplierKey: q.supplierKey ?? '',
                                      },
                                )
                              }
                            >
                              <T k={editing ? '닫기' : '정의'} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {panelOpen && (
                      <tr className="border-b border-gray-100 bg-slate-50/70">
                        <td colSpan={8} className="px-5 py-4">
                          <MeasurementPanel indicator={q} canWrite={canMeasure} canVoid={canVoid} canDefine={isAdmin} />
                          <QiFlowPanel indicator={q} />
                        </td>
                      </tr>
                    )}
                    {isAdmin && !agendaOnly && editing && edit && (
                      <tr className="border-b border-gray-100 bg-gray-50/70">
                        <td colSpan={8} className="px-5 py-4">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="text-[11px] text-gray-600">
                              <span className="block mb-1"><T k="지표 방향" /></span>
                              <select
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
                                value={edit.direction}
                                onChange={(e) => setEdit({ ...edit, direction: e.target.value })}
                              >
                                <option value="">{tAttr('(등재 안 함 — 판정 불가)')}</option>
                                <option value="LOWER_IS_BETTER">{tAttr('낮을수록 좋음')}</option>
                                <option value="HIGHER_IS_BETTER">{tAttr('높을수록 좋음')}</option>
                              </select>
                            </label>
                            <label className="text-[11px] text-gray-600">
                              <span className="block mb-1"><T k="표시 단위" /></span>
                              <input
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-28 bg-white"
                                placeholder={tAttr('예: % · 일 · 분 · 건')}
                                maxLength={20}
                                value={edit.unit}
                                onChange={(e) => setEdit({ ...edit, unit: e.target.value })}
                              />
                            </label>
                            <label className="text-[11px] text-gray-600">
                              <span className="block mb-1"><T k="측정값 배율" /></span>
                              <input
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-24 bg-white"
                                placeholder="100 / 1000 / 1"
                                inputMode="numeric"
                                value={edit.valueScale}
                                onChange={(e) => setEdit({ ...edit, valueScale: e.target.value })}
                              />
                            </label>
                            <label className="text-[11px] text-gray-600">
                              <span className="block mb-1"><T k="자동 산출 공급원" /></span>
                              <SupplierSelect value={edit.supplierKey} onChange={(v) => setEdit({ ...edit, supplierKey: v })} />
                            </label>
                            <label className="text-[11px] text-gray-600">
                              <span className="block mb-1"><T k="변경 사유(5자 이상)" /></span>
                              <input
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-64 bg-white"
                                data-qi-change-reason="edit"
                                value={edit.changeReason}
                                onChange={(e) => setEdit({ ...edit, changeReason: e.target.value })}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={saveMut.isPending || !reasonOk(edit.changeReason)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50"
                              onClick={() => saveMut.mutate(edit)}
                            >
                              <T k="등재" />
                            </button>
                            <p className="text-[10px] text-gray-500 basis-full">
                              <T k="비우면 등재 해제 — 코드 등재표(있으면)로 내려가고, 거기에도 없으면 판정 불가로 남습니다. 등재값은 코드 등재표보다" /> <b><T k="우선" /></b><T k="합니다. 과거 측정값은 수정하지 않고 읽는 시점에 재판정합니다." />
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 기준 시점 — 가장 최근 측정 기간(없으면 표기하지 않는다) */
function asOf(indicators: QiIndicator[]): string | null {
  return indicators.reduce<string | null>(
    (acc, i) => (i.latestPeriod && (!acc || i.latestPeriod > acc) ? i.latestPeriod : acc),
    null,
  );
}

function asOfText(indicators: QiIndicator[]) {
  const p = asOf(indicators);
  return p ? <span className="ml-2 text-gray-400"><T k="· 최신 측정" /> {p} <T k="기준" /></span> : null;
}

/** 공급원 고르기 — '' = 수기 지표 · 라벨은 정본(QI_SUPPLIERS) */
function SupplierSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tAttr = useTAttr();
  return (
    <select className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white" value={value} onChange={(e) => onChange(e.target.value)} data-qi-supplier-select>
      <option value="">{tAttr('(없음 — 수기 지표)')}</option>
      {(Object.keys(QI_SUPPLIERS) as QiSupplierKey[]).map((k) => (
        <option key={k} value={k}>{tAttr(QI_SUPPLIER_DEFINITION[k]?.name ?? k)}</option>
      ))}
    </select>
  );
}
