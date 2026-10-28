'use client';

import React from 'react';
import { TERM_EN_UNREGISTERED, type TermLangMode } from '@hospital-run/shared';
import { useTermLang } from '@/stores/term-lang-store';

/**
 * 의료용어 표시 정본 — 화면은 이름 쌍만 주고, 모드는 이 부품이 훅으로 읽는다(<Num> 패턴).
 * 기획 `medical-term-display-toggle.plan.md` §2.1.
 *
 * 렌더 규칙(정직성):
 *  - KO   : nameKo → 없으면 nameEn(있는 언어를 그대로 — 조용한 공백 금지)
 *  - EN   : nameEn → 🔴 없으면 nameKo + '영문명 미등록' 티. 기계번역·로마자 변환으로
 *           지어내지 않는다 — 지어낸 번역이 임상에서 제일 위험하다.
 *  - BOTH : nameKo (nameEn) — 인쇄 처방전·검색 드롭다운의 기존 병기 관례.
 *
 * 🔴 인쇄·대외 출력물(print/*)은 이 부품/훅을 쓰지 않는다 — 표기 선호가 대외 문서를
 *    바꾸면 안 된다(가드 term-display.spec.tsx 가 동결).
 */

export interface TermNames {
  nameKo?: string | null;
  nameEn?: string | null;
}

/** 문자열형 — 목록·타이틀 등 ReactNode 를 못 받는 자리용. enMissing 은 티 부착 여부를 알려준다 */
export function termTextOf(t: TermNames, mode: TermLangMode): { text: string; enMissing: boolean } {
  const ko = t.nameKo?.trim() || '';
  const en = t.nameEn?.trim() || '';
  if (mode === 'EN') {
    if (en) return { text: en, enMissing: false };
    return { text: ko, enMissing: !!ko };
  }
  if (mode === 'BOTH' && ko && en) return { text: `${ko} (${en})`, enMissing: false };
  // KO(및 병기 불가): 있는 언어를 그대로
  return { text: ko || en, enMissing: false };
}

/**
 * <Term nameKo nameEn /> — 의료용어 한 개.
 * EN 모드에서 영문명이 없으면 한글 + 미등록 티(시각+title)를 붙인다.
 */
export function Term({ nameKo, nameEn, className }: TermNames & { className?: string }) {
  const mode = useTermLang();
  const { text, enMissing } = termTextOf({ nameKo, nameEn }, mode);
  if (!text) return <span className={className}>-</span>;
  return (
    <span className={className} title={enMissing ? TERM_EN_UNREGISTERED : undefined}>
      {/**
       * BiDi 격리(아랍어 트랙 R-A0) — 용어는 `급성 인두염 (Acute pharyngitis)` 처럼 괄호 병기가 되고
       * 코드·약어(`E6591`·`WBC`)가 그대로 들어온다. 괄호는 중립 문자라 RTL 문맥에서 열림/닫힘이
       * 뒤집히고 병기 조각의 순서가 무너진다. 바깥 span 은 그대로 두고 **내용만** 감싼다(LTR no-op).
       */}
      <bdi>
        {text}
        {enMissing && (
          <sup className="ml-0.5 select-none text-[9px] text-gray-400" aria-label={TERM_EN_UNREGISTERED}>EN×</sup>
        )}
      </bdi>
    </span>
  );
}
