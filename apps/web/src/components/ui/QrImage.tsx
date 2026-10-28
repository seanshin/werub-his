'use client';

/**
 * QR 이미지 — **로컬 생성 정본**(2026-08-18).
 *
 * 🔴 종전에는 8개 화면이 `https://api.qrserver.com/v1/create-qr-code/?data=…` 로
 *    **QR 내용을 외부 서버 URL 쿼리에 담아 전송**했다. URL 쿼리는 외부 서비스의
 *    접근 로그·리퍼러·중간 프록시에 그대로 남는다. 실려 나가던 것:
 *      · 환자 팔찌/포털 QR — **MRN·성명·생년월일·성별**(PHI 직접 유출)
 *      · 기기 페어링 코드·직원 기기 등록 링크·설문 링크(자격증명·토큰)
 *      · 내부 호스트명(`window.location.origin`)
 *    부수 결함으로 **폐쇄망(인터넷 차단)에서는 QR 이 아예 렌더되지 않는다** —
 *    팔찌 인쇄가 조용히 빈 사각형으로 나온다.
 *
 * 이제 `qrcode`(MIT, 번들 포함)로 **브라우저 안에서** 생성한다. 내용은 어디로도 나가지 않는다.
 * 생성 실패는 숨기지 않는다 — 빈 이미지 대신 "QR 생성 실패"를 표시한다(깨진 QR 을 스캔시키지 않는다).
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import { T, useTAttr } from '@/components/ui/i18n-text';

/** 인쇄 팝업 등 명령형 경로용 — data:URL 을 만든다. 실패는 `null`(빈 문자열로 위장하지 않는다). */
export async function qrDataUrl(value: string, size = 200, margin = 2): Promise<string | null> {
  const v = String(value ?? '');
  if (!v) return null;
  try {
    return await QRCode.toDataURL(v, { width: size, margin, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}

export interface QrImageProps {
  /** QR 에 담을 값. 외부로 나가지 않는다. */
  value: string;
  /** 픽셀 크기(정사각). */
  size?: number;
  alt: string;
  className?: string;
  margin?: number;
}

export function QrImage({ value, size = 200, alt, className, margin = 2 }: QrImageProps) {
  const tAttr = useTAttr();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    qrDataUrl(value, size, margin).then((d) => {
      if (!alive) return;
      if (d) setSrc(d);
      else setFailed(true);
    });
    return () => { alive = false; };
  }, [value, size, margin]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} — ${tAttr('QR 생성 실패')}`}
        style={{ width: size, height: size }}
        className={`flex items-center justify-center rounded-lg border border-dashed border-red-200 bg-red-50 text-[11px] text-red-600 ${className ?? ''}`}
      >
        <T k="QR 생성 실패" />
      </div>
    );
  }

  if (!src) {
    return (
      <div
        aria-hidden
        style={{ width: size, height: size }}
        className={`rounded-lg bg-gray-100 animate-pulse ${className ?? ''}`}
      />
    );
  }

  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={src} alt={alt} width={size} height={size} className={className} />;
}
