'use client';

/**
 * 표준 발효 거버넌스 — **정의하고 구성을 고르는 자리** (2026-08-27 · 계획서 §3.5).
 *
 * 사람 지시: *"실제 의료기관의 프로세스와 프로토콜, CP가 동작되기 위한 위원회의 의사결정과정을
 * 정의하고 구성을 선택할 수 있는 관리기능이 효과적으로 구성되어야 함."*
 *
 * 🔴 발단(운영 실측 2026-08-27): 발효 중인 진료 표준 **9건 전부 의결 근거가 없었다.**
 *    임상경로는 관리자 클릭 한 번으로 전 병원에 발효됐고 발행자조차 남지 않았다.
 *
 * 🔴 이 화면이 지키는 것 셋:
 *   ① **막지 않는다** — 환자에게 적용 중인 표준을 근거 없다고 멈추면 그건 진료 중단이다.
 *      기본 WARN 이고, BLOCK 승격은 위원회가 정한다(그 자체가 결정 사안이다).
 *   ② **"의결 근거 없음"과 "규칙 미설정"을 구분한다** — 다른 사실이다.
 *   ③ **선택지로 고르게 한다** — 자유 입력이면 어휘가 갈라져 규칙이 규칙이 아니게 된다.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate } from '@/components/ui/display';
import { BASIS_KINDS, BASIS_KIND_LABEL, type BasisKind } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Kind = 'PATHWAY' | 'PROTOCOL' | 'PROCESS';
type ActionReq = 'COMMITTEE' | 'DELEGATED' | 'NONE';

interface Owner { id: string; code: string | null; name: string }
interface Rule {
  gateMode: string;
  actions: Partial<Record<'ENACT' | 'AMEND' | 'RETIRE', ActionReq>>;
  requireBasis: string[];
  reviewCycleM: number | null;
  delegationRef: string | null;
  scopeIsCode: boolean;
}
interface StandardRow {
  kind: Kind; code: string; name: string; status: string; version: number | null;
  scope: string | null;
  publishedAt: string | null; publishedBy: string | null; governanceRef: string | null;
  surfaceKey: string; owners: Owner[];
  rule: Rule | null;
  state: 'NOT_ACTIVE' | 'DECIDED' | 'NO_BASIS';
  ruleState: 'RULE' | 'NO_RULE';
}
interface Res {
  standards: StandardRow[];
  summary: { total: number; active: number; withBasis: number; rulesDefined: number };
}

const KIND_LABEL: Record<Kind, string> = { PATHWAY: '임상경로(CP)', PROTOCOL: '프로토콜', PROCESS: '프로세스' };

/** 🔴 3상 — "근거 없음"과 "규칙 미설정"은 다른 사실이다 */
const STATE_VIEW: Record<StandardRow['state'], { label: string; cls: string; title: string }> = {
  DECIDED: { label: '의결로 발효', cls: 'bg-emerald-50 text-emerald-700', title: '이 표준은 위원회 의결을 근거로 발효됐습니다' },
  NO_BASIS: { label: '의결 근거 없음', cls: 'bg-amber-50 text-amber-800', title: '발효돼 있으나 의결 근거가 없습니다 — 지금 값은 수동 발행입니다' },
  NOT_ACTIVE: { label: '미발효', cls: 'bg-gray-100 text-gray-500', title: '아직 발효되지 않았습니다' },
};

const GATE_VIEW: Record<string, { label: string; cls: string }> = {
  OFF: { label: 'OFF', cls: 'bg-gray-100 text-gray-500' },
  WARN: { label: 'WARN', cls: 'bg-amber-50 text-amber-700' },
  BLOCK: { label: 'BLOCK', cls: 'bg-rose-50 text-rose-700' },
};

const ACTION_LABEL: Record<'ENACT' | 'AMEND' | 'RETIRE', string> = { ENACT: '제정', AMEND: '개정', RETIRE: '폐지' };
const REQ_LABEL: Record<ActionReq, string> = {
  COMMITTEE: '위원회 의결 필수',
  DELEGATED: '위원회가 위임한 경미개정',
  NONE: '요구하지 않음',
};

export default function StandardGovernancePage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [edit, setEdit] = useState<StandardRow | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['gov-standards'],
    queryFn: () => apiClient.get<{ data: Res }>('/api/v1/governance/standards'),
  });
  const res = data?.data;
  const rows = res?.standards ?? [];
  const s = res?.summary;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-gray-900"><T k="표준 발효 거버넌스" /></h1>
          <Link href="/admin/governance" className="text-xs text-indigo-600 hover:text-indigo-800">← <T k="위원회 대장" /></Link>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          <T k="프로세스·프로토콜·CP가" /> <b><T k="무엇이 있어야 발효되는가" /></b><T k="를 정의합니다." />
        </p>
        {/* 🔴 이 문장이 이 화면의 안전장치다 */}
        <p className="text-[11px] text-gray-400 mt-1">
          <T k="이미 발효된 표준은" /> <b><T k="막지 않습니다." /></b> <T k="환자에게 적용 중인 표준을 근거가 없다는 이유로 멈추면 그것은 안전측이 아니라 진료 중단입니다. 기본은" /> <b>WARN</b><T k="이고, BLOCK 승격은 위원회가 정합니다." />
        </p>
      </div>

      {isError && <QueryErrorFallback error={error} onRetry={() => refetch()} />}

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* 🔴 분모를 함께 낸다 — "근거 없음 N건"만 보면 전체 규모를 모른다 */}
          <Stat label="표준 전체" value={`${s.total}`} />
          <Stat label="발효 중" value={`${s.active}`} />
          <Stat label="의결 근거 있음" value={`${s.withBasis} / ${s.active}`} tone={s.withBasis < s.active ? 'warn' : 'ok'} />
          <Stat label="요건이 정의된 규칙" value={`${s.rulesDefined}`} tone={s.rulesDefined === 0 ? 'warn' : 'ok'} />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon="📋" title="표준이 없습니다" className="bg-white rounded-2xl border" />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 border-b border-gray-100">
                <th className="text-left px-4 py-2 font-medium"><T k="표준" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="담당" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="발효 상태" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="발행" /></th>
                <th className="text-left px-4 py-2 font-medium"><T k="요건" /></th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.surfaceKey} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-[11px] text-gray-400 font-mono"><T k={KIND_LABEL[r.kind]} /> · {r.code}{r.scope ? ` · ${r.scope}` : ''}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {/* 🔴 담당이 없으면 없다고 말한다 — 침묵하면 정해진 것처럼 보인다 */}
                    {r.owners.length === 0
                      ? <span className="text-amber-700"><T k="담당 미지정" /></span>
                      : r.owners.map((o) => o.code ?? o.name).join(' + ')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span title={tAttr(STATE_VIEW[r.state].title)} className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATE_VIEW[r.state].cls}`}>
                      <T k={STATE_VIEW[r.state].label} />
                    </span>
                    {r.governanceRef && <span className="ml-1.5 text-[11px] font-mono text-indigo-600">⚖ {r.governanceRef}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-gray-500">
                    {/* 🔴 발행자가 없으면 없다고 말한다 — 종전엔 컬럼조차 없었다 */}
                    {r.publishedAt ? <KDate value={r.publishedAt} mode="date" /> : <span className="text-gray-300">-</span>}
                    <div className="text-gray-400">{r.publishedBy ? <T k="발행자 기록됨" /> : <span className="text-amber-700"><T k="발행자 미기록" /></span>}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.rule ? (
                      <span className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${GATE_VIEW[r.rule.gateMode]?.cls ?? 'bg-gray-100'}`}>
                          {GATE_VIEW[r.rule.gateMode]?.label ?? r.rule.gateMode}
                        </span>
                        <span className="text-[11px] text-gray-500"><T k={r.rule.scopeIsCode ? '개별' : '유형 기본'} /></span>
                      </span>
                    ) : (
                      // 🔴 "규칙 미설정"은 "근거 없음"과 다른 사실이다
                      <span className="text-[11px] text-gray-400"><T k="규칙 미설정" /></span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setEdit(r)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50"><T k="요건 정의" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <RuleModal row={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['gov-standards'] }); }} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-3">
      <p className="text-[11px] text-gray-400"><T k={label} /></p>
      <p className={`text-lg font-bold ${tone === 'warn' ? 'text-amber-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

/** 구성 선택 — 🔴 자유 입력이 아니라 **선택지**여야 어휘가 갈라지지 않는다 */
function RuleModal({ row, onClose, onDone }: { row: StandardRow; onClose: () => void; onDone: () => void }) {
  const tAttr = useTAttr();
  const [scopeIsCode, setScopeIsCode] = useState(row.rule?.scopeIsCode ?? false);
  const [actions, setActions] = useState<Record<'ENACT' | 'AMEND' | 'RETIRE', ActionReq>>({
    ENACT: row.rule?.actions?.ENACT ?? 'COMMITTEE',
    AMEND: row.rule?.actions?.AMEND ?? 'COMMITTEE',
    RETIRE: row.rule?.actions?.RETIRE ?? 'COMMITTEE',
  });
  const [requireBasis, setRequireBasis] = useState<string[]>(row.rule?.requireBasis ?? []);
  const [reviewCycleM, setReviewCycleM] = useState<string>(row.rule?.reviewCycleM ? String(row.rule.reviewCycleM) : '');
  const [gateMode, setGateMode] = useState(row.rule?.gateMode ?? 'WARN');
  const [delegationRef, setDelegationRef] = useState(row.rule?.delegationRef ?? '');
  const [busy, setBusy] = useState(false);

  const needsDelegation = Object.values(actions).includes('DELEGATED');
  const ready = !needsDelegation || !!delegationRef.trim();

  const save = async () => {
    setBusy(true);
    try {
      await apiClient.post('/api/v1/governance/standards/rules', {
        standardKind: row.kind,
        ...(scopeIsCode ? { standardCode: row.code } : {}),
        actions, requireBasis,
        reviewCycleM: reviewCycleM ? Number(reviewCycleM) : null,
        gateMode,
        delegationRef: delegationRef.trim() || null,
      });
      toast.success(tAttr('발효 요건을 저장했습니다.'));
      onDone();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? tAttr('저장에 실패했습니다.'));
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900"><T k="발효 요건" /> — {row.name}</h3>
        <p className="text-[11px] text-gray-400"><T k={KIND_LABEL[row.kind]} /> · {row.code}</p>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="적용 범위" /></label>
          <div className="flex gap-2">
            {([false, true] as const).map((v) => (
              <button key={String(v)} type="button" onClick={() => setScopeIsCode(v)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${scopeIsCode === v ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-200 text-gray-600'}`}>
                {v ? <T k="이 표준만" /> : <><T k={KIND_LABEL[row.kind]} /> <T k="전체 기본" /></>}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {(['ENACT', 'AMEND', 'RETIRE'] as const).map((a) => (
            <div key={a}>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k={ACTION_LABEL[a]} /></label>
              <div className="flex flex-wrap gap-1.5">
                {(['COMMITTEE', 'DELEGATED', 'NONE'] as ActionReq[]).map((r) => (
                  <button key={r} type="button" onClick={() => setActions((s) => ({ ...s, [a]: r }))}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border ${actions[a] === r ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-200 text-gray-600'}`}>
                    <T k={REQ_LABEL[r]} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {needsDelegation && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-2.5">
            <label className="block text-[11px] font-medium text-amber-900 mb-1"><T k="위임 근거 의결번호 *" /></label>
            <input value={delegationRef} onChange={(e) => setDelegationRef(e.target.value)} placeholder="GOV-2026-003"
              className="w-full px-2 py-1.5 border border-amber-200 rounded-lg text-sm font-mono" />
            {/* 🔴 이 문구가 3층 원칙을 지킨다 */}
            <p className="text-[10px] text-amber-700 mt-1">
              <T k="위원회가" /> <b><T k="“이 범위는 소유부서가 정한다”고 의결한 적이 있어야" /></b> <T k="전결이 성립합니다. 그 근거 없이 전결하면 부서장이 위원회를 대신하는 것이고, 결정의 층이 무너집니다." />
            </p>
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="필요 근거 (복수 선택 · 기본 없음)" /></label>
          <div className="flex flex-wrap gap-1.5">
            {BASIS_KINDS.map((k: BasisKind) => (
              <button key={k} type="button"
                onClick={() => setRequireBasis((s) => s.includes(k) ? s.filter((x) => x !== k) : [...s, k])}
                className={`px-2.5 py-1 rounded-lg text-[11px] border ${requireBasis.includes(k) ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-200 text-gray-600'}`}>
                <T k={BASIS_KIND_LABEL[k]} />
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1"><T k="요구하지 않는 것이 기본입니다 — 강제하면 아무 문장이나 채워집니다." /></p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="재심의 주기" /></label>
            <select value={reviewCycleM} onChange={(e) => setReviewCycleM(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm">
              <option value="">{tAttr('없음')}</option>
              <option value="12">12{tAttr('개월')}</option>
              <option value="24">24{tAttr('개월')}</option>
              <option value="36">36{tAttr('개월')}</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-0.5"><T k="주기를 지어내지 않습니다." /></p>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="시행 강도" /></label>
            <div className="flex gap-1">
              {(['OFF', 'WARN', 'BLOCK'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setGateMode(m)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border ${gateMode === m ? GATE_VIEW[m].cls + ' border-current' : 'border-gray-200 text-gray-400'}`}>
                  {m}
                </button>
              ))}
            </div>
            {gateMode === 'BLOCK' && (
              // 🔴 BLOCK 은 사람이 그 뜻을 알고 켜야 한다
              <p className="text-[10px] text-rose-700 mt-1">
                <T k="요건 미충족 시" /> <b><T k="발효가 막힙니다." /></b> <T k="이미 발효된 표준은 그대로지만, 다음 제정·개정이 멈춥니다 — 위원회 결정으로 켜세요." />
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={!ready || busy}
            className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-indigo-700">
            <T k={busy ? '저장 중…' : '요건 저장'} />
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
        </div>
      </div>
    </div>
  );
}
