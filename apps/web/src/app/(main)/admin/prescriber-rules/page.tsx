'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Rules {
  enabled: boolean;
  allowDelegate: boolean;
  requireDelegateAuth: boolean;
  allowedRoles: string[];
  requireSpecialtyMatch: boolean;
  requireAttending: boolean;
  departmentGuidelines: Record<string, string>;
}

const ROLE_OPTS: [string, string][] = [['DOCTOR', '의사'], ['ADMIN', '관리자']];

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc: string }) {
  return (
    <label className="flex items-start justify-between gap-3 py-3 cursor-pointer">
      <div>
        <div className="text-sm font-medium text-gray-800"><T k={label} /></div>
        <div className="text-xs text-gray-500"><T k={desc} /></div>
      </div>
      <button type="button" onClick={() => onChange(!on)} className={`mt-0.5 w-10 h-6 rounded-full shrink-0 transition-colors ${on ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

export default function PrescriberRulesPage() {
  const tAttr = useTAttr();
  const [r, setR] = useState<Rules | null>(null);
  const [saving, setSaving] = useState(false);
  const [newDept, setNewDept] = useState('');

  useEffect(() => {
    apiClient.get<{ data: Rules }>('/api/v1/prescriptions/prescriber-rules')
      .then((res) => setR(res.data))
      .catch(() => toast.error('규칙 로드 실패'));
  }, []);

  if (!r) return <div className="p-4 text-sm text-gray-400"><T k="불러오는 중…" /></div>;
  const set = (p: Partial<Rules>) => setR((x) => ({ ...x!, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiClient.put<{ data: Rules }>('/api/v1/prescriptions/prescriber-rules', r);
      setR(res.data);
      toast.success('처방의 지정 규칙 저장됨');
    } catch (e) { toast.error((e as { message?: string })?.message ?? '저장 실패'); }
    finally { setSaving(false); }
  };

  const guidelineEntries = Object.entries(r.departmentGuidelines ?? {});
  const setGuideline = (dept: string, text: string) => set({ departmentGuidelines: { ...r.departmentGuidelines, [dept]: text } });
  const removeGuideline = (dept: string) => { const g = { ...r.departmentGuidelines }; delete g[dept]; set({ departmentGuidelines: g }); };
  const addDept = () => {
    const d = newDept.trim();
    if (!d) return;
    if (r.departmentGuidelines?.[d] != null) { toast.error('이미 있는 진료과입니다'); return; }
    set({ departmentGuidelines: { ...r.departmentGuidelines, [d]: '' } });
    setNewDept('');
  };

  return (
    <div className="w-full p-4 max-w-3xl">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="처방의 지정 규칙" /></h1>
          <p className="text-sm text-gray-500"><T k="처방·오더 발행 시 책임 처방의(주치의/전문의) 지정·위임 인증·진료과 가이드라인을 설정합니다." /></p>
        </div>
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={saving ? '저장 중…' : '저장'} /></button>
      </div>

      {/* 🔴 위임 처방은 사람 결정이다(2026-10-21 임상 규칙 P3 · 결정 등록부 배치 10-L) — 이 화면이 설정을 바로 바꿀 수 있다는 사실과 함께 말한다 */}
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-delegate-decision>
        <p className="font-semibold"><T k="대리(위임) 처방 허용은 위원회 결정 사항입니다" /></p>
        <p><T k="의료법상 처방 주체 문제라 허가권자 검토 뒤 위원회가 정합니다 — 결정 전에는 켜지 마세요. 이 화면은 설정을 바로 바꿀 수 있지만 그것은 결정이 아닙니다." /></p>
        <a href="/admin/decisions/prescription.delegatePolicy" className="font-semibold underline" data-delegate-decision-link><T k="결정 화면에서 보기" /></a>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 divide-y divide-gray-50">
        <Toggle on={r.enabled} onChange={(v) => set({ enabled: v })} label="기능 활성화" desc="끄면 기존 동작(처방의=작성자 본인)으로 무중단 운영됩니다." />
        {r.enabled && <>
          <Toggle on={r.allowDelegate} onChange={(v) => set({ allowDelegate: v })} label="대리(위임) 처방 허용" desc="전공의·간호사가 입력하고 책임 처방의를 다른 의사로 지정 가능." />
          {r.allowDelegate && (
            <Toggle on={r.requireDelegateAuth} onChange={(v) => set({ requireDelegateAuth: v })} label="위임 시 지정 처방의 인증 필수" desc="지정 처방의의 스마트폰 생체승인(step-up) 후 발행. 권장: 켜기." />
          )}
          <Toggle on={r.requireSpecialtyMatch} onChange={(v) => set({ requireSpecialtyMatch: v })} label="전문과/진료과 일치" desc="처방의 진료과가 해당 진료 진료과와 일치해야 지정 가능." />
          <Toggle on={r.requireAttending} onChange={(v) => set({ requireAttending: v })} label="입원 환자는 담당 의료군만" desc="입원 환자는 담당 의료군(주치의·입원담당의·해당진료의·활성 협진의·추가 지정의)만 처방의로 지정. 특수환자는 입원 화면에서 지정의를 배치하세요. (의료법 §18 직접 진찰한 의사)" />

          <div className="py-3">
            <div className="text-sm font-medium text-gray-800 mb-2"><T k="처방의가 될 수 있는 역할" /></div>
            <div className="flex gap-2">
              {ROLE_OPTS.map(([role, lbl]) => {
                const on = r.allowedRoles.includes(role);
                return (
                  <button key={role} onClick={() => set({ allowedRoles: on ? r.allowedRoles.filter((x) => x !== role) : [...r.allowedRoles, role] })}
                    className={`text-xs px-3 py-1.5 rounded-full border ${on ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><T k={lbl} /></button>
                );
              })}
            </div>
          </div>

          <div className="py-3">
            <div className="text-sm font-medium text-gray-800 mb-2"><T k="진료과별 처방 가이드라인" /></div>
            <p className="text-xs text-gray-500 mb-2"><T k="처방 작성 화면에서 해당 진료과 의사에게 표시됩니다." /></p>
            <div className="space-y-2">
              {guidelineEntries.map(([dept, text]) => (
                <div key={dept} className="flex items-start gap-2">
                  <span className="text-xs font-medium text-gray-700 w-24 shrink-0 pt-2">{dept}</span>
                  <textarea value={text} onChange={(e) => setGuideline(dept, e.target.value)} rows={2} className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" placeholder={tAttr('가이드라인 내용')} />
                  <button onClick={() => removeGuideline(dept)} className="text-xs text-red-400 hover:text-red-600 pt-2"><T k="삭제" /></button>
                </div>
              ))}
              {!guidelineEntries.length && <div className="text-xs text-gray-400"><T k="등록된 가이드라인이 없습니다." /></div>}
            </div>
            <div className="flex gap-2 mt-2">
              <input value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder={tAttr('진료과명 (예: 내과)')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg flex-1" />
              <button onClick={addDept} className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"><T k="진료과 추가" /></button>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
