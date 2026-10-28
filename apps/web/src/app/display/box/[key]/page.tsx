'use client';

import { use, useEffect, useState } from 'react';
import { CheckupBoard } from '../../_boards/CheckupBoard';
import { ClinicQueueBoard } from '../../_boards/ClinicQueueBoard';
import { ErFlowBoard } from '../../_boards/ErFlowBoard';
import { LegacyWaitingBoard } from '../../_boards/LegacyWaitingBoard';

/**
 * TV 박스(설치 단말) 진입점(D9) — 단말엔 이 URL 한 줄만 설정한다.
 * 무엇을 틀지는 서버가 정하고(`/api/v1/displays/box/:key`), **60초마다 구성을 재확인**해
 * 관리 화면에서 바꾸면 TV 를 만지지 않고 반영된다. 보드 본체는 직접 URL 경로와 같은 컴포넌트.
 */

interface BoxConfig { name: string; boardType: string | null; config: { departments?: string[]; tts?: boolean } }

export default function DisplayBoxPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [box, setBox] = useState<BoxConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${apiUrl}/api/v1/displays/box/${encodeURIComponent(key)}`);
        if (!r.ok) { if (alive) { setError(r.status === 401 ? '등록되지 않았거나 비활성화된 단말입니다' : '구성을 불러오지 못했습니다'); } return; }
        const j = await r.json();
        if (alive) { setBox(j.data); setError(null); }
      } catch { if (alive) setError('서버에 연결할 수 없습니다'); }
    };
    load();
    const timer = setInterval(load, 60_000); // 구성 재확인 — 관리 화면 변경 무인 반영
    return () => { alive = false; clearInterval(timer); };
  }, [key]);

  if (error) {
    return (
      <div className="fixed inset-0 bg-[#0a0e16] text-white flex flex-col items-center justify-center gap-4">
        <p className="text-5xl font-black">단말 구성 오류</p>
        <p className="text-2xl text-gray-400">{error}</p>
        <p className="text-xl text-gray-600 font-mono">{key.slice(0, 8)}…</p>
      </div>
    );
  }
  if (!box) return <div className="fixed inset-0 bg-[#0a0e16]" />;

  if (box.boardType === 'clinic-queue') {
    return <ClinicQueueBoard departments={(box.config?.departments ?? []).join(',')} initialTts={box.config?.tts} />;
  }
  if (box.boardType === 'er-flow') return <ErFlowBoard />;
  // 🔴 종전엔 이 분기가 없어서, 세팅 화면에서 '외래 호출 전광판(구형)'을 고르고 "저장했습니다"를
  //    받아도 TV 는 계속 "보드 미지정"을 띄웠다(2026-08-14 W8·P16). 지정할 수 있는 보드는 전부 그린다.
  if (box.boardType === 'waiting') {
    return <LegacyWaitingBoard departments={(box.config?.departments ?? []).join(',')} />;
  }
  // 🔴 검진 대기 보드(`/display/checkup`)는 공개 화면으로 살아 있는데 박스에 지정할 수 없었다(W9).
  //    보드가 하나 늘 때마다 여기와 서버 boardType 허용 목록을 같이 손대야 한다 — 한 곳만 고치면 갈라진다.
  if (box.boardType === 'checkup') return <CheckupBoard />;

  return (
    <div className="fixed inset-0 bg-[#0a0e16] text-white flex flex-col items-center justify-center gap-4">
      <p className="text-5xl font-black">{box.name}</p>
      <p className="text-2xl text-gray-400">
        {box.boardType ? `알 수 없는 보드 종류입니다 (${box.boardType})` : '표시할 보드가 아직 지정되지 않았습니다'}
      </p>
      <p className="text-xl text-gray-600">관리자 &gt; 시스템 관리 &gt; TV 디스플레이 관리에서 이 단말에 보드를 지정해 주세요</p>
    </div>
  );
}
