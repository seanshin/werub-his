'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { SignaturePad, type SignaturePadHandle } from '@/components/signature/SignaturePad';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 내 서명 등록 — /settings/my-signature
 *
 * 🔴 2026-08 W7: 등록된 서명 88건이 전부 시드 자동생성 SVG(`data:image/svg+xml;base64,PHN2` · 554~570B)
 *    인데 화면은 "본인의 전자서명으로 간주 · 의료법 §24-2" 라고 단언했다. 서명패드는 PNG 를 만들고
 *    서버 검증은 PNG/JPEG 만 통과시키므로, **사람이 그린 서명은 0건**이며 이 이미지들은 정본 검증 밖에서
 *    들어온 것이다. 데이터는 건드리지 않고(지우지도 만들지도 않는다) 화면이 사실을 말하게 한다:
 *    본인이 그린 서명이 아니면 법적 효력 문구를 붙이지 않는다.
 */

/** 서명패드(정본 경로)가 만들어 서버 검증(PNG/JPEG 화이트리스트)을 통과한 이미지인가. */
function isPadSignature(image: string | null | undefined): boolean {
  return !!image && /^data:image\/(png|jpe?g);base64,/.test(image);
}

export default function MySignaturePage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const padRef = useRef<SignaturePadHandle>(null);
  const [empty, setEmpty] = useState(true);

  // 🔴 종전: `.catch(() => ({ data: { signatureImage: null } }))` — 조회 실패를 '미등록'으로 렌더했다.
  //    등록되어 있는데 "없음"이라 말하면 사용자는 덮어쓰기를 하게 된다. 실패는 실패로 표시한다.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-signature'],
    queryFn: () => apiClient.get<{ data: { signatureImage: string | null } }>('/api/v1/users/me/signature'),
  });
  const current = ((data?.data as { data?: { signatureImage: string | null } })?.data ?? data?.data) as { signatureImage: string | null } | undefined;
  const stored = current?.signatureImage ?? null;
  const padSigned = isPadSignature(stored);

  const saveMut = useMutation({
    mutationFn: (image: string | null) => apiClient.put('/api/v1/users/me/signature', { signatureImage: image }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-signature'] }); toast.success(tAttr('서명이 저장되었습니다')); },
    onError: () => toast.error(tAttr('저장 실패')),
  });

  const save = () => {
    const img = padRef.current?.toDataURL();
    if (!img) { alert(tAttr('서명을 입력해주세요')); return; }
    saveMut.mutate(img);
  };

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="내 서명 등록" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="등록한 서명은 동의서·의무기록 등 전자서명 시 자동으로 표시됩니다." /></p>
      </div>

      {isError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 mb-4">
          <p className="text-sm font-semibold text-rose-800"><T k="현재 등록된 서명을 확인하지 못했습니다" /></p>
          <p className="text-xs text-rose-600 mt-1">
            {/* 🔴 <b> 강조가 한국어 어미(‘…입니다’) 안쪽을 가른다 — 조각내 번역하면 어느 언어에서도 문장이
                되지 않는다. 문장 단위로만 등재하고 강조는 원문 구조를 지킨다. */}
            ‘미등록’이 아니라 <b>조회 실패</b>입니다 — 이미 등록된 서명이 있을 수 있으니 확인 전에는 새로 저장하지 마세요.
            <span className="ml-1 text-rose-400">({error instanceof Error ? error.message : tAttr('알 수 없는 오류')})</span>
          </p>
          <button onClick={() => refetch()} className="mt-3 text-xs px-3 py-1.5 rounded-full border border-rose-300 bg-white text-rose-700"><T k="다시 시도" /></button>
        </div>
      )}

      {!isError && !isLoading && stored && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4">
          <p className="text-xs font-medium text-gray-500 mb-2"><T k="현재 등록된 서명" /></p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stored} alt={tAttr('현재 서명')} className="h-24 object-contain bg-gray-50 rounded-lg border border-gray-100 px-3" />
          {padSigned ? (
            <p className="mt-2 text-[11px] text-gray-400"><T k="이 화면의 서명패드로 직접 등록한 서명입니다." /></p>
          ) : (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-[12px] font-semibold text-amber-900">⚠ <T k="본인이 그린 서명이 아닙니다 — 시스템이 자동 생성한 임시 이미지입니다." /></p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                서명패드는 PNG 를 만들지만 이 이미지는 다른 형식(자동 생성 SVG 등)으로 들어온 것입니다.
                <b> 전자서명으로서의 효력을 주장할 수 없으며</b>, 동의서·의무기록에 찍히기 전에 아래에서 직접 서명해 교체하세요.
              </p>
            </div>
          )}
          <button onClick={() => saveMut.mutate(null)} className="mt-3 text-xs text-red-500 underline"><T k="서명 삭제" /></button>
        </div>
      )}

      {!isError && !isLoading && !stored && (
        <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5 mb-4 text-sm text-gray-500">
          <T k="등록된 서명이 없습니다." />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <p className="text-xs font-medium text-gray-500"><T k={stored ? '새 서명으로 변경' : '아래 칸에 서명을 그려주세요'} /></p>
        <SignaturePad ref={padRef} height={220} onChange={setEmpty} />
        <div className="flex gap-2">
          <button onClick={save} disabled={empty || saveMut.isPending} className="flex-1 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40"><T k={saveMut.isPending ? '저장 중...' : '서명 저장'} /></button>
        </div>
        {/* 🔴 법적 효력 문구는 '여기서 직접 그려 저장한 서명'에만 붙인다 — 자동 생성 이미지에까지 붙이지 않는다. */}
        <p className="text-[11px] text-gray-400">⚖️ <b>이 칸에 직접 그려 저장한 서명</b>은 본인의 전자서명으로 간주되며, 의료법 제24조의2 설명·동의 및 의무기록 서명에 사용됩니다.</p>
      </div>
    </div>
  );
}
