'use client';

import Link from 'next/link';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface HandoffItem {
  id: string;
  illness?: string;
  patientSummary?: string;
  fromDoctor: { familyName: string; givenName: string };
  toDoctor: { familyName: string; givenName: string };
  patient: { familyName: string; givenName: string };
  createdAt: string;
  acknowledgedAt?: string | null;
}

/* 🔴 색만으로 중증도를 말하지 않는다(§4.6) — 어휘는 `/handoffs` 정본(ILLNESS_CONFIG)과 같다.
   미기재를 초록 '안정'으로 접지 않는다(P1·P17) — 종전 점은 illness 가 없어도 초록이었다. */
const ILLNESS_WORD: Record<string, string> = { CRITICAL: '위급', UNSTABLE: '불안정', STABLE: '안정' };
const ILLNESS_DOT: Record<string, string> = { CRITICAL: 'bg-red-500', UNSTABLE: 'bg-orange-400', STABLE: 'bg-green-400' };
const illnessWord = (v?: string) => (v ? ILLNESS_WORD[v] ?? v : '중증도 미기재');

export default function PendingHandoffBanner() {
  const tt = useTAttr();
  const { data } = useQuery({
    queryKey: ['handoffs-pending'],
    queryFn: () => apiClient.get<{ data: HandoffItem[] }>('/api/v1/handoffs/pending'),
    refetchInterval: pollMs('normal'),
  });

  const raw = data?.data;
  const handoffs: HandoffItem[] = Array.isArray(raw) ? raw : (raw as any)?.data ?? [];
  const pending = handoffs.filter(h => !h.acknowledgedAt);

  if (pending.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="text-sm font-bold text-amber-800"><T k="미확인 인수인계" /> {pending.length}<Unit><T k="건" /></Unit></span>
        </div>
        <Link href="/handoffs" className="text-xs font-medium text-amber-700 hover:text-amber-900 bg-amber-100 px-3 py-1.5 rounded-lg">
          <T k="확인하기" /> →
        </Link>
      </div>
      <div className="mt-2 space-y-1">
        {pending.slice(0, 3).map(h => (
          <div key={h.id} className="flex items-center gap-2 text-xs text-amber-700">
            <span
              aria-label={tt(illnessWord(h.illness))}
              title={tt(illnessWord(h.illness))}
              className={`w-2 h-2 rounded-full ${ILLNESS_DOT[h.illness ?? ''] ?? 'bg-gray-300'}`}
            />
            <span className="font-medium">{h.patient.familyName}{h.patient.givenName}</span>
            <span className="text-amber-500">←</span>
            <span>{h.fromDoctor.familyName}{h.fromDoctor.givenName}</span>
            <span className="text-amber-400 ml-auto">{kdate(h.createdAt, 'time')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
