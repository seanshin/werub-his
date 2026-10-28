'use client';

import { useEffect, useRef, useState, Fragment, ElementType, CSSProperties } from 'react';

interface RevealTextProps {
  text: string;
  /** 렌더 태그 (h2, p 등) */
  as?: ElementType;
  className?: string;
  /** 단어 간 등장 간격(ms) */
  stagger?: number;
  /** 첫 단어 시작 지연(ms) */
  delay?: number;
  style?: CSSProperties;
}

/**
 * 단어 단위로 순차 등장하는 세련된 텍스트 애니메이션.
 * 스크롤 진입 시 각 단어가 아래에서 페이드업 + blur→선명 으로 나타난다.
 * 한글 어절(공백) 기준 분할 — 단어 사이 일반 공백을 두어 자연스러운 줄바꿈 유지.
 * prefers-reduced-motion 존중(즉시 표시).
 */
export function RevealText({ text, as: Tag = 'div', className = '', stagger = 55, delay = 0, style }: RevealTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.2, rootMargin: '0px 0px -40px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const words = text.split(' ');
  const shown = visible || reduced;

  return (
    <Tag ref={ref} className={className} style={style}>
      {words.map((word, i) => (
        <Fragment key={i}>
          <span
            className="inline-block will-change-[transform,opacity,filter]"
            style={{
              transition: 'opacity 0.7s cubic-bezier(0.22,1,0.36,1), transform 0.7s cubic-bezier(0.22,1,0.36,1), filter 0.7s ease-out',
              transitionDelay: `${delay + i * stagger}ms`,
              opacity: shown ? 1 : 0,
              transform: shown ? 'translateY(0)' : 'translateY(0.45em)',
              filter: shown ? 'blur(0)' : 'blur(8px)',
            }}
          >
            {word}
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </Tag>
  );
}
