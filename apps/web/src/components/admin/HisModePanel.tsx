'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HIS_MODES, HIS_MODE_META, HisMode } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useHisMode } from '@/lib/his-mode';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 운영 모드 전환 패널 — 개발 / 리허설 / 리얼.
 *
 * 🔴 **두 층을 숨기지 않는다.** 빌드 상한은 재배포로만 바뀌고, 여기서 바꾸는 것은 런타임 토글이다.
 *    빌드보다 넓히려 하면 저장은 되지만 **적용되지 않는다** — 그 사실을 그 자리에서 말한다
 *    ("화면이 갖지 않은 권한을 가진 척하지 않는다").
 */
export function HisModePanel() {
  const { build, runtime, effective, runtimeEffective, runtimeUnknown } = useHisMode();
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [saving, setSaving] = useState<HisMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (mode: HisMode) => {
    setSaving(mode); setNotice(null); setError(null);
    try {
      // 🔴 접두 포함 전체 경로 — `apiClient` 는 붙여주지 않는다(같은 실수로 조회가 404 였다)
      const res = await apiClient.put<{ data: { notice: string | null } }>('/api/v1/mode', { mode });
      setNotice(res.data?.notice ?? null);
      await qc.invalidateQueries({ queryKey: ['his-mode'] });
    } catch (e) {
      // 🔴 실패를 성공으로 접지 않는다 — 모드가 안 바뀐 채 바뀐 줄 알면 리허설에서 문자가 나간다
      setError((e as Error)?.message || tAttr('모드 변경에 실패했습니다'));
    } finally {
      setSaving(null);
    }
  };

  const cell = (m: HisMode) => {
    const meta = HIS_MODE_META[m];
    const isEffective = effective === m;
    const isRuntime = runtime === m;
    // 빌드 상한보다 넓은 모드는 고를 수는 있으나 적용되지 않는다 — 그것을 미리 밝힌다
    const widerThanBuild = HIS_MODES.indexOf(m) < HIS_MODES.indexOf(build);
    return (
      <button
        key={m}
        type="button"
        onClick={() => apply(m)}
        disabled={saving !== null}
        className={`flex-1 rounded-xl border px-4 py-3 text-left transition ${
          isEffective ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
        } ${saving ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900"><T k={meta.label} /></span>
          {isEffective && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] text-white"><T k="적용 중" /></span>}
          {isRuntime && !isEffective && (
            <span className="rounded bg-gray-400 px-1.5 py-0.5 text-[10px] text-white"><T k="저장됨(미적용)" /></span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          <T k={m === 'REAL'
            ? '실환자 운영. 시드 로그인 없음 · 대외 발신 허용(채널별 설정·승인은 그대로).'
            : meta.banner} />
        </p>
        {widerThanBuild && (
          <p className="mt-1 text-[11px] font-medium text-amber-700">
            <Tf k="🔴 이 서버는 {빌드} 빌드라 여기로 넓힐 수 없다 — 재배포가 필요하다" params={{ 빌드: build }} />
          </p>
        )}
      </button>
    );
  };

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-bold text-gray-900"><T k="운영 모드" /></h3>
        <span className="text-[11px] text-gray-400"><T k="개발 · 리허설 · 리얼" /></span>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-gray-500">
        {/* 🔴 (2026-09-11 §12-C) 종전엔 16조각이라 어떤 언어에서도 문장이 성립하지 않았다 — 한 문장 한 키(노드 자리표시자) */}
        <Tf k="모드는 {두층}이다." params={{ 두층: <b><T k="두 층" /></b> }} />{' '}
        <Tf k="{빌드상한}({빌드})은 이 배포본에 무엇이 {들어}를 정하고 재배포로만 바뀐다 ({명령})." params={{
          빌드상한: <b><T k="빌드 상한" /></b>,
          빌드: <code className="rounded bg-gray-100 px-1">{build}</code>,
          들어: <b><T k="들어 있는지" /></b>,
          명령: <code className="rounded bg-gray-100 px-1">deploy.sh --mode rehearsal</code>,
        }} />{' '}
        <Tf k="아래 버튼은 {런타임}이며 {좁히기} 한다 — 리얼 빌드에는 시드 로그인 모듈이 아예 없어 런타임으로 되살아나지 않는다." params={{
          런타임: <b><T k="런타임 토글" /></b>,
          좁히기: <b><T k="더 좁히기만" /></b>,
        }} />
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">{HIS_MODES.map(cell)}</div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <dt className="text-gray-400"><T k="빌드 상한" /></dt>
          <dd className="font-semibold text-gray-800">{build}</dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <dt className="text-gray-400"><T k="런타임 토글" /></dt>
          <dd className="font-semibold text-gray-800">
            {runtimeUnknown ? <T k="확인 불가" /> : (runtime ?? <T k="미설정(빌드 모드를 따름)" />)}
          </dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <dt className="text-gray-400"><T k="실효 모드" /></dt>
          <dd className="font-semibold text-gray-800">{effective}</dd>
        </div>
      </dl>

      {!runtimeEffective && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <Tf k="저장된 런타임 값({런타임})이 빌드 상한({빌드})보다 넓어 {강조}. 실효 모드는 {실효} 다." params={{
            런타임: runtime ?? '', 빌드: build, 실효: effective, 강조: <b><T k="적용되지 않았다" /></b>,
          }} />
        </p>
      )}
      {notice && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{notice}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</p>}
      {runtimeUnknown && (
        <p className="mt-3 text-[11px] text-gray-400">
          <T k="서버에서 런타임 값을 읽지 못했다 — 지금 표시는 빌드 모드 기준이다(모르는 것을 아는 척하지 않는다)." />
        </p>
      )}
    </div>
  );
}
