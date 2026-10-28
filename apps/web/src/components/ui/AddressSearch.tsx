'use client';

import { useCallback, useEffect } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

// 카카오(다음) 우편번호 서비스 — 무료·키 불필요·'동' 검색 지원
const SCRIPT_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

export interface AddressValue {
  zonecode?: string;     // 우편번호
  roadAddress?: string;  // 도로명 주소
  jibunAddress?: string; // 지번 주소
  sido?: string;
  sigungu?: string;
  bname?: string;        // 동
  detail?: string;       // 상세주소(직접 입력)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { daum?: any } }

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.daum?.Postcode) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('주소 검색 스크립트 로드 실패'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function AddressSearch({ value, onChange }: { value?: AddressValue; onChange: (v: AddressValue) => void }) {
  const tAttr = useTAttr();
  useEffect(() => { loadScript().catch(() => {}); }, []);

  const open = useCallback(async () => {
    try {
      await loadScript();
      if (!window.daum?.Postcode) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new window.daum.Postcode({
        oncomplete: (data: any) => {
          onChange({
            zonecode: data.zonecode,
            roadAddress: data.roadAddress || data.address,
            jibunAddress: data.jibunAddress,
            sido: data.sido,
            sigungu: data.sigungu,
            bname: data.bname,
            detail: value?.detail ?? '',
          });
        },
      }).open();
    } catch { /* 무시 */ }
  }, [onChange, value?.detail]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={value?.roadAddress ?? ''}
          onChange={(e) => onChange({ ...(value ?? {}), roadAddress: e.target.value })}
          placeholder={tAttr('동 이름으로 검색하거나 주소 직접 입력')}
          className="flex-1 px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
        />
        <button type="button" onClick={open}
          className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 whitespace-nowrap">
          {'🔍 '}<T k="주소 검색" />
        </button>
      </div>
      {(value?.roadAddress || value?.detail || value?.zonecode) && (
        <div className="flex gap-2">
          <input value={value?.zonecode ?? ''} onChange={(e) => onChange({ ...(value ?? {}), zonecode: e.target.value })} placeholder={tAttr('우편번호')}
            className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none" />
          <input
            value={value?.detail ?? ''}
            onChange={(e) => onChange({ ...(value ?? {}), detail: e.target.value })}
            placeholder={tAttr('상세주소 (동/호수 등)')}
            className="flex-1 px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none"
          />
        </div>
      )}
    </div>
  );
}

/** AddressValue → CreatePatientDto.address 매핑 */
export function toPatientAddress(a?: AddressValue) {
  if (!a?.roadAddress) return undefined;
  return {
    line1: a.roadAddress,
    line2: a.detail || undefined,
    city: a.sigungu || a.sido || '',
    state: a.sido || undefined,
    postalCode: a.zonecode || undefined,
    country: 'KR',
  };
}
