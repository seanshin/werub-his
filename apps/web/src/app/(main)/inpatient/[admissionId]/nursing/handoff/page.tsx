'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

interface HandoffSbar {
  enabled: boolean;
  source: string;
  sbar: { situation: string; background: string; assessment: string; recommendation: string };
  items: { unsignedNotes: number; overdueMeds: number; activeDiagnoses: number };
}

const SECTIONS: { key: keyof HandoffSbar['sbar']; label: string; letter: string; cls: string }[] = [
  { key: 'situation', label: 'Situation (상황)', letter: 'S', cls: 'border-blue-200 bg-blue-50/40' },
  { key: 'background', label: 'Background (배경)', letter: 'B', cls: 'border-emerald-200 bg-emerald-50/40' },
  { key: 'assessment', label: 'Assessment (사정)', letter: 'A', cls: 'border-amber-200 bg-amber-50/40' },
  { key: 'recommendation', label: 'Recommendation (제안·인계)', letter: 'R', cls: 'border-purple-200 bg-purple-50/40' },
];

export default function NursingHandoffPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'disabled' | 'error'>('idle');
  const [data, setData] = useState<HandoffSbar | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setState('loading'); setData(null); setCopied(false);
    try {
      const res = await apiClient.get<{ data: HandoffSbar }>(`/api/v1/admissions/${admissionId}/ai-handoff-sbar`);
      const r = ((res as { data?: { data?: HandoffSbar } })?.data?.data ?? (res as { data?: HandoffSbar })?.data) as HandoffSbar;
      setData(r); setState('ready');
    } catch (e) {
      setState((e as { code?: string })?.code === 'AI_ASSIST_DISABLED' ? 'disabled' : 'error');
    }
  };

  const copyAll = () => {
    if (!data) return;
    const text = SECTIONS.map((s) => `[${s.letter}] ${s.label}\n${data.sbar[s.key]}`).join('\n\n');
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/inpatient/${admissionId}/nursing/notes`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600">← <T k="간호일지" /></Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900"><T k="교대 인수인계 (SBAR)" /></h1>
        <div className="flex gap-2">
          {state === 'ready' && <button onClick={copyAll} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">{copied ? <><T k="복사됨" /> ✓</> : <T k="전체 복사" />}</button>}
          <button onClick={generate} disabled={state === 'loading'} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm hover:bg-amber-700 disabled:opacity-50">
            {state === 'loading' ? <T k="생성 중…" /> : state === 'idle' ? <>✦ <T k="SBAR 생성" /></> : <T k="다시 생성" />}
          </button>
        </div>
      </div>

      {state === 'idle' && (
        <p className="text-sm text-gray-500"><T k="활력징후·EWS·낙상·활성 간호진단·미서명 기록·투약 지연을 근거로 SBAR 인계 초안을 구성합니다(데이터 기반·읽기 보조). 인계 책임은 간호사에게 있습니다." /></p>
      )}
      {state === 'disabled' && <p className="text-sm text-gray-500">간호 {AI_ORIGIN_TEXT} 보조가 비활성 상태입니다(관리자 설정 필요).</p>}
      {state === 'error' && <p className="text-sm text-rose-600"><T k="SBAR를 생성하지 못했습니다. 다시 시도하세요." /></p>}

      {state === 'ready' && data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className={`px-2 py-0.5 rounded-full ${data.items.unsignedNotes ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-500'}`}><T k="미서명" /> {data.items.unsignedNotes}</span>
            <span className={`px-2 py-0.5 rounded-full ${data.items.overdueMeds ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}><T k="투약지연" /> {data.items.overdueMeds}</span>
            <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700"><T k="활성 진단" /> {data.items.activeDiagnoses}</span>
          </div>
          {SECTIONS.map((s) => (
            <div key={s.key} className={`rounded-xl border p-4 ${s.cls}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="flex-shrink-0 w-6 h-6 rounded bg-white/70 text-gray-700 text-xs font-bold flex items-center justify-center">{s.letter}</span>
                <span className="text-xs font-semibold text-gray-600"><T k={s.label} /></span>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap pl-8">{data.sbar[s.key]}</p>
            </div>
          ))}
          <p className="text-[11px] text-gray-400"><T k="데이터 근거로만 구성(임상사실 임의 생성 없음). 검토 후 인계하세요." /></p>
        </div>
      )}
    </div>
  );
}
