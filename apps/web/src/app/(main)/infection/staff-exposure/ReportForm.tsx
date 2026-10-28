'use client';

/**
 * 직원 혈액·체액 노출 사고 **신고 폼** — 2026-08-18.
 *
 * 🔴 이 폼이 없으면 서버만 정직해지고 아무도 사고를 신고할 수 없다(EP 는 2026-08-18 영속화됐다).
 * 🔴 원환자 감염상태는 **미상이 기본값**이고, 미상은 전송하지 않는다(`serologyToPayload`).
 *    화면에서 `false` 를 만들어 보내면 원장에 '음성'이 박히고, 그건 PEP 판단을 뒤집는다.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import PatientSelector from '@/components/ui/PatientSelector';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import {
  EXPOSURE_TYPES,
  EXPOSURE_TYPE_LABEL,
  SEROLOGY_INPUTS,
  serologyToPayload,
  type SerologyInput,
} from './staff-exposure-labels';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface FormState {
  exposureType: string;
  occurredAt: string;
  bodyPart: string;
  deviceType: string;
  place: string;
  sourcePatientId: string;
  sourceHbv: SerologyInput;
  sourceHcv: SerologyInput;
  sourceHiv: SerologyInput;
  ppeUsed: string;
  immediateAction: string;
  prophylaxis: string;
  followUpNotes: string;
}

const EMPTY: FormState = {
  exposureType: 'NEEDLESTICK',
  occurredAt: '',
  bodyPart: '',
  deviceType: '',
  place: '',
  sourcePatientId: '',
  // 🔴 기본은 미상 — 모르는 것을 음성으로 시작하지 않는다
  sourceHbv: 'UNKNOWN',
  sourceHcv: 'UNKNOWN',
  sourceHiv: 'UNKNOWN',
  ppeUsed: '',
  immediateAction: '',
  prophylaxis: '',
  followUpNotes: '',
};

const LABEL = 'block text-xs font-medium text-gray-600 mb-1';
const INPUT =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

function SerologyRadio({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: SerologyInput;
  onChange: (v: SerologyInput) => void;
}) {
  return (
    <div>
      <span className={LABEL}><T k={label} /></span>
      <div className="flex gap-1">
        {SEROLOGY_INPUTS.map((o) => {
          const on = value === o.value;
          const tone = on
            ? o.value === 'POSITIVE'
              ? 'bg-red-100 text-red-700 border-red-300'
              : o.value === 'NEGATIVE'
                ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                : 'bg-amber-100 text-amber-800 border-amber-300'
            : 'bg-white text-gray-500 border-gray-200';
          return (
            <label
              key={o.value}
              className={`flex-1 cursor-pointer rounded-lg border px-2 py-1.5 text-center text-xs font-medium ${tone}`}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                checked={on}
                onChange={() => onChange(o.value)}
              />
              <T k={o.label} />
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportForm({ onReported }: { onReported?: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errorText, setErrorText] = useState<string | null>(null);
  const qc = useQueryClient();
  const tAttr = useTAttr();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      // 🔴 미상(UNKNOWN)은 **키 자체를 넣지 않는다** — undefined 는 JSON.stringify 가 지운다.
      const body: Record<string, unknown> = {
        exposureType: form.exposureType,
        occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined,
        bodyPart: form.bodyPart.trim() || undefined,
        deviceType: form.deviceType.trim() || undefined,
        place: form.place.trim() || undefined,
        sourcePatientId: form.sourcePatientId || undefined,
        sourceHbv: serologyToPayload(form.sourceHbv),
        sourceHcv: serologyToPayload(form.sourceHcv),
        sourceHiv: serologyToPayload(form.sourceHiv),
        ppeUsed: form.ppeUsed.trim() || undefined,
        immediateAction: form.immediateAction.trim() || undefined,
        prophylaxis: form.prophylaxis.trim() || undefined,
        followUpNotes: form.followUpNotes.trim() || undefined,
      };
      return apiClient.post('/api/v1/infection-control/staff-exposure', body);
    },
    onSuccess: () => {
      setErrorText(null);
      setForm(EMPTY);
      toast.success(tAttr('노출 사고가 접수됐습니다 — 추적관찰이 시작됩니다'));
      qc.invalidateQueries({ queryKey: ['staff-exposure'] });
      onReported?.();
    },
    // 🔴 실패는 실패로 말한다 — 토스트만 띄우고 지나가면 "접수됐겠지"라고 읽는다
    onError: (e) => setErrorText(extractErrorMessage(e)),
  });

  return (
    <form
      className="rounded-2xl border border-gray-100 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900"><T k="노출 사고 신고" /></h3>
        {/* 🔴 강조가 문장 한가운데 걸린 안전 문구 — 조각으로 쪼개면 어순이 깨진다(노드 자리표시자 한 키) */}
        <Tf
          className="mt-0.5 block text-xs text-gray-500"
          k="피노출자는 로그인한 본인으로 기록됩니다. 원환자 감염상태를 모르면 {미상} 그대로 두십시오 — 음성으로 접수되면 예방요법 판단이 뒤집힙니다."
          params={{ 미상: <span className="font-medium text-amber-700"><T k="미상" /></span> }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="exposureType">
            <T k="노출 유형" /> <span className="text-red-500">*</span>
          </label>
          <select
            id="exposureType"
            className={INPUT}
            value={form.exposureType}
            onChange={(e) => set('exposureType', e.target.value)}
          >
            {EXPOSURE_TYPES.map((t) => (
              <option key={t} value={t}>
                {tAttr(EXPOSURE_TYPE_LABEL[t])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="occurredAt">
            <T k="발생 시각" />
          </label>
          <input
            id="occurredAt"
            type="datetime-local"
            className={INPUT}
            value={form.occurredAt}
            onChange={(e) => set('occurredAt', e.target.value)}
          />
          {/* 🔴 비우면 서버가 접수 시각을 쓴다 — 모르는 시각을 화면이 지어내지 않는다 */}
          <p className="mt-1 text-[10px] text-gray-400"><T k="비우면 접수 시각으로 기록됩니다" /></p>
        </div>
        <div>
          <label className={LABEL} htmlFor="place">
            <T k="발생 장소" />
          </label>
          <input
            id="place"
            className={INPUT}
            placeholder={tAttr('예: 3병동 처치실')}
            value={form.place}
            onChange={(e) => set('place', e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="bodyPart">
            <T k="노출 부위" />
          </label>
          <input
            id="bodyPart"
            className={INPUT}
            placeholder={tAttr('예: 좌측 검지')}
            value={form.bodyPart}
            onChange={(e) => set('bodyPart', e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="deviceType">
            <T k="원인 기구" />
          </label>
          <input
            id="deviceType"
            className={INPUT}
            placeholder={tAttr('예: 18G 주사바늘')}
            value={form.deviceType}
            onChange={(e) => set('deviceType', e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="ppeUsed">
            <T k="착용 PPE" />
          </label>
          <input
            id="ppeUsed"
            className={INPUT}
            placeholder={tAttr('예: 니트릴 장갑 1겹')}
            value={form.ppeUsed}
            onChange={(e) => set('ppeUsed', e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/60 p-4">
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-800"><T k="원환자 · 감염상태" /></p>
          <Tf
            className="mt-0.5 block text-[11px] text-gray-600"
            k="원환자를 지정하지 않으면 {무명}로 기록됩니다 — 검사 자체가 불가능하므로 음성으로 간주하지 마십시오."
            params={{ 무명: <span className="font-medium"><T k="무명 노출" /></span> }}
          />
        </div>
        <div className="mb-3">
          <PatientSelector
            value={form.sourcePatientId}
            onChange={(id) => set('sourcePatientId', id)}
            placeholder={tAttr('원환자 검색 (선택 · 무명 노출이면 비워 둡니다)')}
          />
          {form.sourcePatientId && (
            <button
              type="button"
              className="mt-1 text-[11px] text-gray-500 hover:underline"
              onClick={() => set('sourcePatientId', '')}
            >
              <T k="원환자 지정 해제(무명 노출)" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SerologyRadio
            name="sourceHbv"
            label={tAttr('HBsAg (B형간염)')}
            value={form.sourceHbv}
            onChange={(v) => set('sourceHbv', v)}
          />
          <SerologyRadio
            name="sourceHcv"
            label={tAttr('anti-HCV (C형간염)')}
            value={form.sourceHcv}
            onChange={(v) => set('sourceHcv', v)}
          />
          <SerologyRadio
            name="sourceHiv"
            label="HIV"
            value={form.sourceHiv}
            onChange={(v) => set('sourceHiv', v)}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="immediateAction">
            <T k="즉시 조치" />
          </label>
          <textarea
            id="immediateAction"
            rows={2}
            className={INPUT}
            placeholder={tAttr('예: 흐르는 물에 세척, 압출하지 않음')}
            value={form.immediateAction}
            onChange={(e) => set('immediateAction', e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="prophylaxis">
            <T k="예방조치(PEP·백신)" />
          </label>
          <textarea
            id="prophylaxis"
            rows={2}
            className={INPUT}
            placeholder={tAttr('시행한 것만 적습니다')}
            value={form.prophylaxis}
            onChange={(e) => set('prophylaxis', e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="followUpNotes">
            <T k="비고" />
          </label>
          <textarea
            id="followUpNotes"
            rows={2}
            className={INPUT}
            value={form.followUpNotes}
            onChange={(e) => set('followUpNotes', e.target.value)}
          />
        </div>
      </div>

      {errorText && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          <Tf k="접수되지 않았습니다 — {사유}" params={{ 사유: errorText }} />
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          <T k={mutation.isPending ? '접수 중…' : '노출 사고 접수'} />
        </button>
        <button
          type="button"
          className="text-xs text-gray-500 hover:underline"
          onClick={() => {
            setForm(EMPTY);
            setErrorText(null);
          }}
        >
          <T k="초기화" />
        </button>
      </div>
    </form>
  );
}
