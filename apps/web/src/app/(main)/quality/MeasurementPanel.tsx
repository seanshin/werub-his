'use client';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { KDate } from '@/components/ui/display';
import { toast } from '@/stores/toast-store';
import {
  DIRECTION_LABEL,
  SCALE_SOURCE_LABEL,
  UNDETERMINED_LABEL,
  fmtMeasurementValue,
  meetTargetLabel,
  parseCount,
  previewMeasurementValue,
  unitSuffix,
  type QiIndicator,
  type QiMeasurementResult,
  type QiMeasurementRow,
} from './quality-types';

/**
 * 질 지표 **측정값 입력 + 측정 이력** 패널.
 *
 * 🔴 신설 배경(2026-08-18): `POST /api/v1/quality/measurements` 와
 *    `GET /api/v1/quality/measurements/:indicatorId` 는 **부르는 화면이 web·mobile 어디에도 없었다**.
 *    지표를 등재해도 측정값을 넣을 방법이 없었고(EP 를 만들면 부르는 화면까지가 한 벌),
 *    쌓인 측정 이력도 화면에서 볼 수 없었다.
 *
 * 이 패널이 지키는 것 —
 *  1. **배율·단위를 밝힌다.** 같은 분자/분모라도 배율이 다르면 값이 달라진다(3/1000 은 ×100 이면 0.3,
 *     ×1000 이면 3). 배율이 어디서 왔는지(등재/산출공식/가정)까지 적는다.
 *  2. **분모 0 은 저장을 시도하지 않는다.** 표본 부재는 '값 0' 이 아니다 — 0 으로 나눈 값을 지어내지 않는다.
 *  3. **방향 미등재 지표도 저장은 된다.** 다만 '판정 불가'로 표시하고, 어디서 등재하는지(같은 행 [정의])
 *     를 안내한다. 모르는 것을 '달성'으로 접지 않는다.
 *  4. **판정은 서버가 읽는 시점에 재판정한 값**을 쓴다. 저장 당시 기록(`storedMeetTarget`)과 갈리면
 *     그 사실을 표에 드러낸다(어느 한쪽을 조용히 지우지 않는다).
 *  5. **저장 실패를 성공으로 말하지 않는다.** 실패하면 입력값을 지우지 않고 서버 메시지를 그대로 보여준다.
 */

/** 최근 N건까지만 내려온다(서버 `take: 12`). 자르면 잘랐다고 말한다. */
const HISTORY_LIMIT = 12;

/** 이번 달(로컬 기준) — 컨테이너 OS 가 UTC 라 `toISOString()` 은 월초/월말에 한 달 밀린다. */
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MeasurementPanel({
  indicator,
  canWrite,
  canVoid = false,
  canDefine = false,
}: {
  indicator: QiIndicator;
  /** 측정값 입력·정정 권한(`qi:measure:write` — 기본 ADMIN·NURSE). 없으면 이력만 본다. */
  canWrite: boolean;
  /**
   * 무효화 권한(`qi:measure:void` — 기본 ADMIN). 🔴 입력보다 **좁다**:
   * 무효화는 그 기간을 집계·화면에서 사라지게 하고 같은 기간을 다시 쓸 수 있게 열기 때문에,
   * 입력자가 자기 입력을 스스로 없앨 수 있으면 '나쁜 달을 지우고 다시 쓰는' 경로가 된다.
   */
  canVoid?: boolean;
  /**
   * 지표 정의(방향·단위·배율) 등재 권한 = 같은 행 [정의] 버튼(ADMIN).
   * 🔴 측정 입력 권한과 **다르다** — 입력만 가진 사람에게 "[정의]에서 등재하십시오"라고 말하면
   *    없는 버튼을 가리키게 된다(화면이 할 수 없는 일을 하라고 시키는 것).
   */
  canDefine?: boolean;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod());
  const [numeratorRaw, setNumeratorRaw] = useState('');
  const [denominatorRaw, setDenominatorRaw] = useState('');
  /**
   * 2026-10-09 — 외부 기관이 통보한 결과(심평원 적정성 평가 등)는 출처 EXTERNAL 로 넣는다(결정 qi.hiraIndicatorSet 의 '공표 결과만 기록').
   * 종전엔 화면 입력이 무조건 MANUAL 이라 외부 결과와 원내 수기 측정이 구별되지 않았다. 통보 문서·번호를 함께 받는다.
   */
  const [source, setSource] = useState<'MANUAL' | 'EXTERNAL'>('MANUAL');
  const [externalRef, setExternalRef] = useState('');
  const [saved, setSaved] = useState<QiMeasurementResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['qi-measurements', indicator.id],
    queryFn: () =>
      apiClient.get<{ data: QiMeasurementRow[] }>(`/api/v1/quality/measurements/${indicator.id}`),
  });

  const rows: QiMeasurementRow[] = useMemo(() => {
    const raw = history.data?.data as unknown;
    return Array.isArray(raw) ? (raw as QiMeasurementRow[]) : [];
  }, [history.data]);

  const numerator = parseCount(numeratorRaw);
  const denominator = parseCount(denominatorRaw);
  const scale = indicator.valueScale;
  const scaleSource = indicator.valueScaleSource ?? (indicator.valueScaleKnown ? 'COLUMN' : 'ASSUMED');
  const preview = previewMeasurementValue(numerator, denominator, scale);

  // 🔴 분모 0 = 산출 불가. 저장 시도조차 하지 않는다(서버도 거절하지만, 화면이 먼저 사실을 말한다).
  const denominatorZero = denominator !== null && denominator <= 0;
  const canSubmit =
    canWrite &&
    period.trim() !== '' &&
    numerator !== null &&
    denominator !== null &&
    !denominatorZero;

  const duplicatePeriod =
    history.isSuccess && period.trim() !== '' && rows.some((r) => r.period === period.trim());

  // ── 정정·무효화 (2026-08-18) ────────────────────────────────────────────────
  const [correctTarget, setCorrectTarget] = useState<QiMeasurementRow | null>(null);
  const [correctNum, setCorrectNum] = useState('');
  const [correctDen, setCorrectDen] = useState('');
  const [voidTarget, setVoidTarget] = useState<{ id: string; period: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const startCorrection = (m: QiMeasurementRow) => {
    setCorrectTarget(m);
    setCorrectNum(String(m.numerator));
    setCorrectDen(String(m.denominator));
    setFailure(null);
  };

  /**
   * 🔴 정정 폼은 현재 분자/분모를 프리필한다 — 그대로 [정정 저장] 을 누르면 값이 **재산출**된다.
   *    운영 측정의 대부분은 저장된 값이 그 행의 분자/분모에서 나온 값이 아니어서(시드가 값을 먼저
   *    정하고 분모를 역산), 손대지 않고 누르기만 해도 값이 10배로 튀었다.
   *    → 바뀐 것이 없으면 저장을 막고(서버도 거절한다), 바뀔 값을 **미리 보여준다**.
   */
  const correctUnchanged =
    correctTarget !== null &&
    Number(correctNum) === correctTarget.numerator &&
    Number(correctDen) === correctTarget.denominator;
  const correctPreview = previewMeasurementValue(parseCount(correctNum), parseCount(correctDen), scale);

  const correctMut = useMutation({
    mutationFn: ({ id, numerator, denominator }: { id: string; numerator: number; denominator: number }) =>
      apiClient.patch(`/api/v1/quality/measurements/${id}`, { numerator, denominator }),
    onSuccess: () => {
      setCorrectTarget(null);
      history.refetch();
    },
    onError: (e: unknown) => setFailure((e as { message?: string })?.message ?? '정정에 실패했습니다'),
  });

  const voidMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/quality/measurements/${id}/void`, { reason }),
    onSuccess: () => {
      setVoidTarget(null);
      setVoidReason('');
      history.refetch();
    },
    onError: (e: unknown) => setFailure((e as { message?: string })?.message ?? '무효화에 실패했습니다'),
  });

  const saveMut = useMutation({
    mutationFn: (body: { period: string; numerator: number; denominator: number }) =>
      apiClient.post<{ data: QiMeasurementResult }>('/api/v1/quality/measurements', {
        indicatorId: indicator.id,
        ...body,
        ...(source === 'EXTERNAL' ? { source: 'EXTERNAL', externalRef: externalRef.trim() } : {}),
      }),
    onSuccess: (res) => {
      const r = (res?.data ?? null) as QiMeasurementResult | null;
      setFailure(null);
      setSaved(r);
      setNumeratorRaw('');
      setDenominatorRaw('');
      // 🔴 "저장했습니다"로 끝내지 않는다 — 무슨 값이 어떤 배율로 들어갔고 판정이 났는지까지 말한다.
      const valueText = fmtMeasurementValue(r ? Number(r.value) : null);
      toast.success(
        valueText === null
          ? '측정값을 저장했습니다.'
          : `측정값 저장 — ${r?.period ?? period} · ${valueText}${unitSuffix(r?.unit)} (×${r?.valueScale ?? scale}) · ${meetTargetLabel(r?.meetTarget ?? null)}`,
      );
      qc.invalidateQueries({ queryKey: ['qi-measurements', indicator.id] });
      qc.invalidateQueries({ queryKey: ['qi-dashboard'] });
    },
    onError: (e: unknown) => {
      // 🔴 실패를 성공으로 말하지 않는다 — 입력값도 지우지 않는다(다시 타이핑시키지 않는다).
      const msg = (e as { message?: string })?.message || '측정값을 저장하지 못했습니다';
      setSaved(null);
      setFailure(msg);
      toast.error(msg);
    },
  });

  const submit = () => {
    // 이중 방어 — 버튼이 비활성이어도(테스트·자동화) 잘못된 요청이 나가지 않게 한다.
    if (!canSubmit || numerator === null || denominator === null || denominator <= 0) return;
    if (source === 'EXTERNAL' && externalRef.trim().length < 3) return;
    saveMut.mutate({ period: period.trim(), numerator, denominator });
  };

  return (
    <div className="space-y-4" data-testid={`qi-panel-${indicator.id}`}>
      {/* ── 적용 기준(배율·단위·방향) — 값을 만들기 전에 무엇이 적용되는지 먼저 밝힌다 ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
        <span>
          <T k="적용 배율" />{' '}
          <b data-testid="qi-scale">×{scale}</b>{' '}
          <span className={scaleSource === 'ASSUMED' ? 'text-amber-600' : 'text-gray-400'}>
            (<T k={SCALE_SOURCE_LABEL[scaleSource]} />)
          </span>
        </span>
        <span>
          <T k="표시 단위" />{' '}
          {indicator.unit ? (
            <b data-testid="qi-unit">{indicator.unit}</b>
          ) : (
            <span className="text-amber-600" data-testid="qi-unit"><T k="단위 미등재" /></span>
          )}
        </span>
        <span>
          <T k="지표 방향" />{' '}
          {indicator.direction ? (
            <b><T k={DIRECTION_LABEL[indicator.direction]} /></b>
          ) : (
            <span className="text-amber-600"><T k="미등재" /></span>
          )}
        </span>
        <span><T k="목표" /> {String(indicator.targetValue)}{unitSuffix(indicator.unit)}</span>
      </div>

      {scaleSource === 'ASSUMED' && (
        <p className="text-[11px] text-amber-700">
          <T k="🔴 배율이 산출공식에도 지표 정의에도 없어" /> <b><T k="백분율(×100)로 가정" /></b><T k="했습니다. 가정이 틀리면 저장되는 값이 100배·1/10 로 어긋납니다(건수 지표는 10건도 저장 한도 999.99 를 넘어 거절됩니다) —" />{' '}
          {canDefine ? (
            <><T k="같은 행" /> <b><T k="[정의]" /></b> <T k="에서 배율을 등재하십시오." /></>
          ) : (
            <><T k="배율 등재는 지표 정의 권한(관리자)이 합니다." /></>
          )}
        </p>
      )}

      {indicator.direction === null && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
          <T k="이 지표는" /> <b><T k="방향 미등재" /></b><T k="입니다. 측정값은" /> <b><T k="저장됩니다" /></b><T k=". 다만 목표 달성 여부는" />{' '}
          <b><T k="판정 불가" /></b><T k="로 남습니다(모르는 것을 달성/미달로 적지 않습니다)." />
{' '}
          <T k={canDefine
            ? '같은 행의 [정의] 버튼에서 방향을 등재하면 저장된 측정값도 읽는 시점에 재판정됩니다.'
            : '방향 등재는 지표 정의 권한(관리자)이 같은 행의 [정의] 버튼에서 합니다 — 측정 입력 권한만으로는 그 버튼이 보이지 않습니다.'} />
        </p>
      )}

      {/* ── 측정값 입력 ── */}
      {canWrite ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs font-semibold text-gray-800 mb-2"><T k="측정값 입력" /></p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-gray-600">
              <span className="block mb-1"><T k="측정기간" /></span>
              <input
                aria-label={tAttr('측정기간')}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-28"
                placeholder="YYYY-MM"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </label>
            <label className="text-[11px] text-gray-600">
              <span className="block mb-1"><T k="분자" /></span>
              <input
                aria-label={tAttr('분자')}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-24"
                inputMode="numeric"
                value={numeratorRaw}
                onChange={(e) => setNumeratorRaw(e.target.value)}
              />
            </label>
            <label className="text-[11px] text-gray-600">
              <span className="block mb-1"><T k="분모" /></span>
              <input
                aria-label={tAttr('분모')}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-24"
                inputMode="numeric"
                value={denominatorRaw}
                onChange={(e) => setDenominatorRaw(e.target.value)}
              />
            </label>
            <label className="text-[11px] text-gray-600">
              <span className="block mb-1"><T k="값의 출처" /></span>
              <select value={source} onChange={(e) => setSource(e.target.value as 'MANUAL' | 'EXTERNAL')} aria-label={tAttr('값의 출처')}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white" data-testid="qi-measure-source">
                <option value="MANUAL">{tAttr('원내 직접 측정(수기)')}</option>
                <option value="EXTERNAL">{tAttr('외부 기관 통보 결과')}</option>
              </select>
            </label>
            {source === 'EXTERNAL' && (
              <label className="text-[11px] text-gray-600">
                <span className="block mb-1"><T k="통보 문서·번호" /></span>
                <input aria-label={tAttr('통보 문서·번호')} className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-40" data-testid="qi-measure-external-ref"
                  value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
              </label>
            )}
            <button
              type="button"
              data-testid="qi-measure-submit"
              disabled={!canSubmit || saveMut.isPending || (source === 'EXTERNAL' && externalRef.trim().length < 3)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50"
              onClick={submit}
            >
              <T k={saveMut.isPending ? '저장 중…' : '측정값 저장'} />
            </button>
          </div>

          {/* 🔴 계산 미리보기 — 적용 배율과 단위를 함께 적는다. '예상'임을 숨기지 않는다. */}
          <div className="mt-2 text-[11px]" data-testid="qi-preview">
            {denominatorZero ? (
              <span className="text-red-600">
                <T k="분모가 0 입니다 —" /> <b><T k="산출 불가" /></b><T k=". 표본 부재는 값 0 이 아니므로 저장을 시도하지 않습니다." />
              </span>
            ) : preview === null ? (
              <span className="text-gray-400"><T k="분자·분모를 입력하면 적용 배율로 계산한 예상값을 보여줍니다." /></span>
            ) : (
              <span className="text-gray-600">
                <T k="예상 산출값(서버가 최종 확정):" />{' '}
                <b className="text-gray-900">
                  {numerator} / {denominator} × {scale} = {fmtMeasurementValue(preview)}
                  {unitSuffix(indicator.unit)}
                </b>
                {scaleSource === 'ASSUMED' && <span className="text-amber-600"> <T k="· 배율 가정값" /></span>}
              </span>
            )}
          </div>

          {duplicatePeriod && !denominatorZero && (
            /* 🔴 2026-08-18: 지표×기간은 하나가 됐다(유니크 제약). 종전 문구("별도 행으로 추가")는
                더 이상 사실이 아니다 — 서버가 거절하고 정정 경로를 안내한다. */
            <p className="mt-1 text-[11px] text-amber-700">
              <T k="같은 기간(" /><b>{period.trim()}</b><T k=") 측정값이 이미 있습니다 — 저장은" /> <b><T k="거절" /></b><T k="됩니다. 고치려면 아래 이력에서" /> <b><T k="정정" /></b><T k="을, 취소하려면" /> <b><T k="무효화" /></b><T k="를 쓰십시오." />
            </p>
          )}

          {/* 저장 결과 — 무엇이 저장됐는지, 판정이 났는지/안 났는지 */}
          {saved && (
            <div
              className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-700"
              data-testid="qi-save-result"
            >
              <T k="저장됨 ·" /> <b>{saved.period}</b> · {saved.numerator} / {saved.denominator} × {saved.valueScale} ={' '}
              <b>
                {fmtMeasurementValue(Number(saved.value)) ?? <T k="산출 불가" />}
                {unitSuffix(saved.unit)}
              </b>{' '}
              ·{' '}
              {saved.meetTarget === null ? (
                <span className="text-gray-600">
                  <b><T k="판정 불가" /></b>
                  {saved.undeterminedReason && <> — <T k={UNDETERMINED_LABEL[saved.undeterminedReason]} /></>}
                </span>
              ) : (
                <span className={saved.meetTarget ? 'text-emerald-700' : 'text-red-700'}>
                  <b><T k={meetTargetLabel(saved.meetTarget)} /></b>
                </span>
              )}
            </div>
          )}

          {failure && (
            <div
              className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700"
              data-testid="qi-save-error"
            >
              <b><T k="저장하지 못했습니다" /></b> — {failure}
              <span className="block text-red-600/80 mt-0.5"><T k="입력값은 그대로 두었습니다. 값을 고쳐 다시 시도하십시오." /></span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-gray-500">
          <T k="측정값 입력·정정에는" /> <b><T k="질지표 입력 권한" /></b>(<code>qi:measure:write</code> <T k="— 기본 관리자·간호)이 필요합니다 — 아래는 저장된 측정 이력입니다." />
        </p>
      )}

      {/* ── 측정 이력 ── */}
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <p className="text-xs font-semibold text-gray-800"><T k="측정 이력" /></p>
          <p className="text-[10px] text-gray-400">
            <T k="판정은" /> <b><T k="읽는 시점 재판정" /></b><T k="(저장된 값을 그대로 믿지 않습니다) · 최근" /> {HISTORY_LIMIT}<T k="건까지 표시" />
          </p>
        </div>

        {history.isLoading ? (
          <p className="text-[11px] text-gray-400"><T k="불러오는 중…" /></p>
        ) : history.isError ? (
          <div className="text-[11px] text-red-600">
            <T k="측정 이력을 불러오지 못했습니다 —" />{' '}
            {(history.error as { message?: string })?.message ?? '알 수 없는 오류'}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => history.refetch()}
            >
              <T k="다시 시도" />
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-gray-400" data-testid="qi-history-empty">
            <T k="저장된 측정값이 없습니다." />
          </p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-1 text-left font-medium"><T k="기간" /></th>
                <th className="py-1 text-right font-medium"><T k="분자" /></th>
                <th className="py-1 text-right font-medium"><T k="분모" /></th>
                <th className="py-1 text-right font-medium"><T k="값" /></th>
                <th className="py-1 text-center font-medium"><T k="판정(재판정)" /></th>
                <th className="py-1 text-left font-medium"><T k="측정시각" /></th>
                {canWrite && <th className="py-1 text-right font-medium"><T k="조치" /></th>}
              </tr>
            </thead>
            <tbody data-testid="qi-history-rows">
              {rows.map((m) => {
                const valueText = fmtMeasurementValue(m.value);
                return (
                  <tr key={m.id} className="border-b border-gray-100">
                    <td className="py-1 font-mono text-gray-700">{m.period}</td>
                    <td className="py-1 text-right text-gray-600">{m.numerator}</td>
                    <td className="py-1 text-right text-gray-600">{m.denominator}</td>
                    <td className="py-1 text-right text-gray-900">
                      {valueText === null ? (
                        <span className="text-gray-400"><T k="기록 없음" /></span>
                      ) : (
                        <>
                          {valueText}
                          {unitSuffix(m.unit)}
                        </>
                      )}
                      {/* 🔴 이 행의 값은 옆 칸의 분자/분모에서 나온 값이 아니다 — 같은 표에 정본이
                          둘이 되는 것(P12)을 감추지 않는다. 값을 고치지 않고 사실만 밝힌다. */}
                      {m.valueDerived === false && (
                        <span
                          className="block text-[10px] text-amber-600"
                          data-testid="qi-value-not-derived"
                          title={`이 행의 값은 분자/분모 × 배율(${m.valueScale})의 산출값과 다릅니다. 정정하면 ${
                            fmtMeasurementValue(m.ratioValue ?? null) ?? '산출 불가'
                          } 로 재산출됩니다.`}
                        >
                          <T k="분자/분모 산출값 아님" />
                          {m.ratioValue != null && ` (산출 시 ${fmtMeasurementValue(m.ratioValue)})`}
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-center">
                      {m.meetTarget === null ? (
                        <span
                          className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500"
                          title={tAttr(UNDETERMINED_LABEL[m.undeterminedReason ?? 'DIRECTION_NOT_REGISTERED'])}
                        >
                          <T k="판정 불가" />
                        </span>
                      ) : (
                        <span
                          className={`px-1.5 py-0.5 rounded-full font-medium ${
                            m.meetTarget ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}
                        >
                          <T k={meetTargetLabel(m.meetTarget)} />
                        </span>
                      )}
                      {/* 🔴 저장값과 재판정이 갈렸다 — 감추지 않는다 */}
                      {m.storedDiverges && (
                        <span
                          className="block text-[10px] text-amber-600"
                          data-testid="qi-stored-diverges"
                          title={tAttr('저장 당시 기록된 판정과 현재 정본 규칙의 재판정이 다릅니다(방향이 나중에 등재·변경됐거나 옛 규칙으로 기록된 행). 표시된 판정이 정본입니다.')}
                        >
                          {tAttr('저장값')} {tAttr(meetTargetLabel(m.storedMeetTarget))} {tAttr('≠ 재판정')}
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-gray-500">
                      <KDate value={m.measuredAt} mode="datetime" unknown="UNRECORDED" />
                    </td>
                    {/* 🔴 종전엔 오기를 고칠 방법이 없었다 — 같은 기간을 다시 넣어도 별도 행으로 쌓였다.
                        무효화는 **지우지 않는다**(QI 는 인증·대외 보고 근거라 무엇이 있었는지가 남아야 한다). */}
                    {canWrite && (
                      <td className="py-1 text-right whitespace-nowrap">
                        <button type="button" onClick={() => startCorrection(m)}
                          className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"><T k="정정" /></button>
                        {/* 🔴 무효화는 입력보다 좁은 권한이다 — 없으면 버튼을 그리지 않는다 */}
                        {canVoid && (
                          <button type="button" onClick={() => setVoidTarget({ id: m.id, period: m.period })}
                            className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700"><T k="무효화" /></button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* 정정 — 기간은 바꾸지 않는다(기간을 옮기려면 무효화 후 새로 입력) */}
        {correctTarget && (
          <div className="mt-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2" data-testid="qi-correct-form">
            <p className="text-[11px] font-medium text-gray-700">
              {correctTarget.period} <T k="정정 — 값과 판정을 다시 산출합니다(기간·지표는 바꾸지 않습니다)" />
            </p>
            <div className="mt-1 flex items-center gap-2">
              <input value={correctNum} onChange={(e) => setCorrectNum(e.target.value)} inputMode="numeric"
                className="w-20 rounded border border-gray-300 px-2 py-1 text-[11px]" placeholder={tAttr('분자')} />
              <span className="text-[11px] text-gray-400">/</span>
              <input value={correctDen} onChange={(e) => setCorrectDen(e.target.value)} inputMode="numeric"
                className="w-20 rounded border border-gray-300 px-2 py-1 text-[11px]" placeholder={tAttr('분모')} />
              <button type="button"
                data-testid="qi-correct-submit"
                disabled={correctMut.isPending || !(Number(correctDen) > 0) || correctNum.trim() === '' || correctUnchanged}
                onClick={() => correctMut.mutate({ id: correctTarget.id, numerator: Number(correctNum), denominator: Number(correctDen) })}
                className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white disabled:opacity-40">
                <T k={correctMut.isPending ? '정정 중…' : '정정 저장'} />
              </button>
              <button type="button" onClick={() => setCorrectTarget(null)}
                className="rounded bg-gray-200 px-2 py-1 text-[11px] text-gray-700"><T k="취소" /></button>
            </div>
            {!(Number(correctDen) > 0) && (
              <p className="mt-1 text-[10px] text-amber-700"><T k="분모는 0보다 커야 합니다 — 표본 부재는 값 0 이 아닙니다." /></p>
            )}
            {/* 🔴 정정하면 값이 어떻게 바뀌는지 **누르기 전에** 말한다 — 저장된 값이 분자/분모에서
                나온 값이 아닐 수 있어(운영 대부분) 손대지 않아도 값이 크게 옮겨간다. */}
            {correctUnchanged ? (
              <p className="mt-1 text-[10px] text-gray-500" data-testid="qi-correct-unchanged">
                <T k="바뀐 값이 없습니다 — 분자·분모를 고쳐야 정정됩니다(누르기만 해도 값이 재산출되지는 않습니다)." />
              </p>
            ) : (
              correctPreview !== null && (
                <p className="mt-1 text-[10px] text-gray-600" data-testid="qi-correct-preview">
                  <T k="재산출 예상값:" /> <b>{fmtMeasurementValue(correctTarget.value) ?? '기록 없음'}</b> →{' '}
                  <b className="text-gray-900">
                    {fmtMeasurementValue(correctPreview)}
                    {unitSuffix(indicator.unit)}
                  </b>{' '}
                  (= {correctNum} / {correctDen} × {scale})
                </p>
              )
            )}
          </div>
        )}

        {/* 무효화 — 지우지 않는다. 사유가 남는다 */}
        {voidTarget && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2" data-testid="qi-void-form">
            <p className="text-[11px] font-medium text-red-700">
              {voidTarget.period} <T k="무효화 — 기록은" /> <b><T k="지워지지 않고" /></b> <T k="사유와 함께 남습니다(집계·조회에서 제외)." />
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1"><ReasonInput domain="qiVoid" required value={voidReason} onChange={setVoidReason}
                className="w-full rounded border border-red-300 px-2 py-1 text-[11px]" placeholder={tAttr('무효화 사유(필수)')} /></div>
              <button type="button" disabled={voidMut.isPending || !reasonFilled(voidReason)}
                onClick={() => voidMut.mutate({ id: voidTarget.id, reason: voidReason.trim() })}
                className="rounded bg-red-600 px-2 py-1 text-[11px] text-white disabled:opacity-40">
                <T k={voidMut.isPending ? '처리 중…' : '무효화'} />
              </button>
              <button type="button" onClick={() => { setVoidTarget(null); setVoidReason(''); }}
                className="rounded bg-gray-200 px-2 py-1 text-[11px] text-gray-700"><T k="취소" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
