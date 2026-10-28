'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

interface Policy {
  version: number; active?: boolean;
  enabledForms: string[]; serialPrefix: string;
  validityMonths: number; refundWindowMonths: number; balanceRefundRate: number;
  maxCommissionRate: number; domesticMaxCommissionRate: number; maxHierarchyDepth: number; prepaymentRequired: boolean;
  foreignerOnly: boolean; allowedCategories: string[]; anchorChainType: string;
  anchorIntervalMin: number; diffPolicy: string;
}
interface Floors { MIN_VALIDITY_MONTHS: number; MIN_REFUND_WINDOW_MONTHS: number; MIN_BALANCE_REFUND_RATE: number; MAX_COMMISSION_RATE_CAP: number; MAX_DOMESTIC_COMMISSION_RATE_CAP: number }

const FORMS = [['PROGRAM', '상품권형'], ['AMOUNT', '금액권형']] as const;
const CATS = ['BASIC', 'PLUS', 'PRECISION', 'PREMIUM', 'SPECIAL'];
const DIFFS = [['RESIDUAL_VOUCHER', '잔액권 발행'], ['REFUND_DIFF', '차액 환불'], ['FORFEIT', '잔액 소멸']] as const;

function NumberField({ label, value, onChange, hint, invalid }: { label: string; value: number; onChange: (v: number) => void; hint?: string; invalid?: boolean }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600"><T k={label} /></label>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full mt-1 px-3 py-2 text-sm border rounded-lg ${invalid ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
      {hint && <p className={`text-[10px] mt-0.5 ${invalid ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>{hint}</p>}
    </div>
  );
}

export default function VoucherSettingsPage() {
  const tAttr = useTAttr();
  const [active, setActive] = useState<Policy | null>(null);
  const [floors, setFloors] = useState<Floors | null>(null);
  const [versions, setVersions] = useState<Policy[]>([]);
  const [form, setForm] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => apiClient.get<{ data: { active: Policy; legalFloors: Floors; versions: Policy[] } }>('/api/v1/voucher/policy')
    .then((r) => { setActive(r.data.active); setFloors(r.data.legalFloors); setVersions(r.data.versions ?? []); setForm({ ...r.data.active }); })
    .catch(() => toast.error('정책 조회 실패'));
  useEffect(() => { load(); }, []);

  const upd = (k: keyof Policy, v: unknown) => setForm((f) => (f ? { ...f, [k]: v } as Policy : f));
  const toggleArr = (k: 'enabledForms' | 'allowedCategories', val: string) =>
    setForm((f) => { if (!f) return f; const a = f[k]; return { ...f, [k]: a.includes(val) ? a.filter((x) => x !== val) : [...a, val] } as Policy; });

  const belowFloor = (k: string, v: number) => {
    if (!floors) return false;
    if (k === 'validityMonths') return v < floors.MIN_VALIDITY_MONTHS;
    if (k === 'refundWindowMonths') return v < floors.MIN_REFUND_WINDOW_MONTHS;
    if (k === 'balanceRefundRate') return v < floors.MIN_BALANCE_REFUND_RATE;
    if (k === 'maxCommissionRate') return v > floors.MAX_COMMISSION_RATE_CAP;
    if (k === 'domesticMaxCommissionRate') return v > floors.MAX_DOMESTIC_COMMISSION_RATE_CAP || (!!form && v > form.maxCommissionRate);
    return false;
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const r = await apiClient.put<{ data: Policy }>('/api/v1/voucher/policy', {
        enabledForms: form.enabledForms, serialPrefix: form.serialPrefix,
        validityMonths: form.validityMonths, refundWindowMonths: form.refundWindowMonths,
        balanceRefundRate: form.balanceRefundRate, maxCommissionRate: form.maxCommissionRate,
        domesticMaxCommissionRate: form.domesticMaxCommissionRate,
        maxHierarchyDepth: form.maxHierarchyDepth, prepaymentRequired: form.prepaymentRequired,
        allowedCategories: form.allowedCategories, anchorChainType: form.anchorChainType,
        anchorIntervalMin: form.anchorIntervalMin, diffPolicy: form.diffPolicy,
      });
      toast.success(`정책 v${r.data.version} 생성(비활성) — 다른 관리자가 활성화(4-eyes)`);
      load();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '저장 실패(법정 하한 위반 가능)'); }
    finally { setSaving(false); }
  };

  const activate = async (version: number) => {
    try { await apiClient.post(`/api/v1/voucher/policy/${version}/activate`, {}); toast.success(`v${version} 활성화`); load(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '활성화 실패(4-eyes: 작성자≠승인자)'); }
  };

  if (!form || !floors) return <div className="p-6 text-sm text-gray-400"><T k="불러오는 중..." /></div>;

  return (
    <div className="w-full p-4 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="검진권 정책 설정" /></h1>
        <p className="text-sm text-gray-500"><T k="법정 하한/상한 내에서 조정 — 위반 시 저장 거부. 변경은 4-eyes 활성화." /></p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-800"><T k="활성 정책" /> v{active?.version ?? 0}{active?.version === 0 && <span className="text-[10px] text-gray-400 ml-1"><T k="(코드 기본값)" /></span>}</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100"><T k="외국인환자 한정 강제(L1)" /></span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <NumberField label="유효기간(개월)" value={form.validityMonths} onChange={(v) => upd('validityMonths', v)} hint={`법정 하한 ${floors.MIN_VALIDITY_MONTHS} 이상`} invalid={belowFloor('validityMonths', form.validityMonths)} />
          <NumberField label="환불청구 기간(개월)" value={form.refundWindowMonths} onChange={(v) => upd('refundWindowMonths', v)} hint={`하한 ${floors.MIN_REFUND_WINDOW_MONTHS} 이상`} invalid={belowFloor('refundWindowMonths', form.refundWindowMonths)} />
          <NumberField label="잔액 환불율(%)" value={form.balanceRefundRate} onChange={(v) => upd('balanceRefundRate', v)} hint={`하한 ${floors.MIN_BALANCE_REFUND_RATE} 이상`} invalid={belowFloor('balanceRefundRate', form.balanceRefundRate)} />
          <NumberField label="해외 딜러 수수료율 상한(%)" value={form.maxCommissionRate} onChange={(v) => upd('maxCommissionRate', v)} hint={`상한 ${floors.MAX_COMMISSION_RATE_CAP} 이하`} invalid={belowFloor('maxCommissionRate', form.maxCommissionRate)} />
          <NumberField label="국내 유치업자 수수료율 상한(%)" value={form.domesticMaxCommissionRate} onChange={(v) => upd('domesticMaxCommissionRate', v)} hint={`상한 ${floors.MAX_DOMESTIC_COMMISSION_RATE_CAP} 이하·해외 이하`} invalid={belowFloor('domesticMaxCommissionRate', form.domesticMaxCommissionRate)} />
          <NumberField label="딜러 계층 깊이" value={form.maxHierarchyDepth} onChange={(v) => upd('maxHierarchyDepth', v)} />
          <NumberField label="앵커 주기(분)" value={form.anchorIntervalMin} onChange={(v) => upd('anchorIntervalMin', v)} />
          <div>
            <label className="text-xs font-semibold text-gray-600"><T k="시리얼 prefix" /></label>
            <input value={form.serialPrefix} onChange={(e) => upd('serialPrefix', e.target.value.toUpperCase())} className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600"><T k="금액권 차액정책" /></label>
            <select value={form.diffPolicy} onChange={(e) => upd('diffPolicy', e.target.value)} className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg">
              {DIFFS.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2"><T k="활성 형태" /></p>
            <div className="flex gap-2">
              {FORMS.map(([v, l]) => (
                <button key={v} onClick={() => toggleArr('enabledForms', v)} className={`text-xs px-3 py-1.5 rounded-lg border ${form.enabledForms.includes(v) ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200'}`}><T k={l} /></button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2"><T k="허용 비급여 프로그램(L2)" /></p>
            <div className="flex flex-wrap gap-1.5">
              {CATS.map((c) => (
                <button key={c} onClick={() => toggleArr('allowedCategories', c)} className={`text-[11px] px-2 py-1 rounded-lg border ${form.allowedCategories.includes(c) ? 'bg-teal-600 text-white border-teal-600' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>{c}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={form.prepaymentRequired} onChange={(e) => upd('prepaymentRequired', e.target.checked)} className="w-4 h-4" /> <T k="선결제 매입 강제" />
          </label>
          <button onClick={save} disabled={saving} className="ml-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={saving ? '저장중...' : '새 버전 저장(비활성)'} /></button>
        </div>
      </div>

      {/* 버전 이력 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-3"><T k="정책 버전" /></h2>
        <div className="space-y-1.5">
          {versions.map((v) => (
            <div key={v.version} className={`flex items-center justify-between px-3 py-2 rounded-xl border ${v.active ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-100'}`}>
              <span className="text-sm text-gray-700">v{v.version} {v.active && <span className="text-[10px] bg-emerald-600 text-white rounded px-1.5 py-0.5 ml-1"><T k="활성" /></span>}
                <span className="text-[11px] text-gray-400 ml-2">유효 {v.validityMonths}<Unit>개월</Unit> · 수수료 해외≤{v.maxCommissionRate}%/국내≤{v.domesticMaxCommissionRate ?? '—'}<Unit>%</Unit> · {v.enabledForms.join('/')}</span></span>
              {!v.active && <button onClick={() => activate(v.version)} className="text-[11px] text-blue-600 border border-blue-200 rounded-lg px-2 py-1 hover:bg-blue-50"><T k="활성화(4-eyes)" /></button>}
            </div>
          ))}
          {versions.length === 0 && <p className="text-xs text-gray-400 py-2"><T k="저장된 버전 없음 — 현재는 코드 기본값으로 동작" /></p>}
        </div>
      </div>
    </div>
  );
}
