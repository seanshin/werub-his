'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePatients } from '@/hooks/usePatients';
import type { PatientListItem } from '@/types/patient';
import { ageOf as sharedAgeOf } from '@hospital-run/shared';

// 나이는 정본 계산을 쓴다 — 자체 구현은 월·일 보정이 없어 생일 전이면 한 살 많았다
function ageOf(dob?: string) {
  const a = sharedAgeOf(dob);
  return a === null ? '?' : String(a);
}

export default function TabletHome() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, isLoading } = usePatients({ q: search.trim() || undefined, limit: 30 });
  const patients = (data?.data ?? []) as PatientListItem[];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 h-16 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-blue-600 text-white grid place-items-center font-bold">W</span>
          <div className="leading-tight">
            <div className="font-bold text-gray-900">WERUBYHOSP</div>
            <div className="text-[11px] text-gray-400">타블렛 차트</div>
          </div>
        </div>
        <div className="flex-1" />
        <a href="/tablet/protocol" className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-blue-700 bg-blue-50 inline-flex items-center">🗂 수술 프로토콜</a>
        <a href="/patients" className="min-h-[44px] px-3 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 inline-flex items-center">⤢ 데스크탑</a>
      </header>

      <div className="p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="환자 이름·MRN 검색…"
          className="w-full h-14 px-5 rounded-2xl border border-gray-200 bg-white text-lg outline-none focus:border-blue-400"
        />
      </div>

      <div className="flex-1 px-4 pb-6">
        {isLoading ? (
          <div className="text-gray-400 text-base p-6">불러오는 중…</div>
        ) : patients.length === 0 ? (
          <div className="text-gray-400 text-base p-6">{search ? '검색 결과 없음' : '환자를 검색하세요.'}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {patients.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/tablet/patients/${p.id}`)}
                className="text-left bg-white rounded-2xl border border-gray-200 shadow-sm p-4 min-h-[88px] active:bg-gray-50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-gray-900 truncate">{p.familyName}{p.givenName}</span>
                  <span className="text-sm text-gray-500">{ageOf(p.dateOfBirth)}세 · {p.gender === 'MALE' ? '남' : p.gender === 'FEMALE' ? '여' : ''}</span>
                  {p.isDeceased && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">사망</span>}
                </div>
                <div className="mt-1 text-sm text-gray-500">{p.mrn} · {p.insuranceType}</div>
                {p.lastVisitDate && <div className="mt-1 text-xs text-gray-400">최근 {p.lastVisitDate.slice(0, 10)}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
