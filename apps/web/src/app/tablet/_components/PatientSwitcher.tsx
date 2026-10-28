'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePatients } from '@/hooks/usePatients';
import type { PatientListItem } from '@/types/patient';
import BottomSheet from './BottomSheet';
import { ageOf as sharedAgeOf } from '@hospital-run/shared';

function ageOf(dob?: string) {
  if (!dob) return '?';
  const d = new Date(dob);
  return String(sharedAgeOf(d) ?? '?');
}

/** 환자 빠른 전환 — 상단 바 버튼 → 검색 시트 → 차트 이동. */
export default function PatientSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data, isLoading } = usePatients({ q: q.trim() || undefined, limit: 20 });
  const patients = (data?.data ?? []) as PatientListItem[];

  return (
    <>
      <button onClick={() => setOpen(true)} className="min-h-[44px] px-3 rounded-xl text-sm font-medium text-gray-600 border border-gray-200">⇄ 환자전환</button>
      <BottomSheet open={open} title="환자 전환" onClose={() => setOpen(false)}>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="환자 이름·MRN 검색…"
          className="w-full h-12 px-4 rounded-xl border border-gray-200 text-base outline-none focus:border-blue-400 mb-3" />
        {isLoading ? (
          <div className="text-gray-400 p-3">불러오는 중…</div>
        ) : patients.length === 0 ? (
          <div className="text-gray-400 p-3">{q ? '검색 결과 없음' : '환자를 검색하세요.'}</div>
        ) : (
          <ul className="space-y-2">
            {patients.map((p) => (
              <li key={p.id}>
                <button onClick={() => { setOpen(false); router.push(`/tablet/patients/${p.id}`); }}
                  className="w-full text-left bg-white rounded-2xl border border-gray-200 p-3 min-h-[64px] active:bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base text-gray-900">{p.familyName}{p.givenName}</span>
                    <span className="text-sm text-gray-500">{ageOf(p.dateOfBirth)}세 · {p.gender === 'MALE' ? '남' : p.gender === 'FEMALE' ? '여' : ''}</span>
                  </div>
                  <div className="text-sm text-gray-500">{p.mrn}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    </>
  );
}
