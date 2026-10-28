'use client';
import { useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: (e: any) => void; onend: () => void; onerror: () => void;
  start: () => void; stop: () => void;
};

/** 음성 받아쓰기 버튼(ko-KR) — 인식 텍스트를 onText로 추가. 미지원 브라우저는 미표시. */
export default function DictationButton({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SR | null>(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    return () => { recRef.current?.stop(); };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (on) { recRef.current?.stop(); setOn(false); return; }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec: SR = new Ctor();
    rec.lang = 'ko-KR';
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const t = String(e.results[i][0].transcript ?? '').trim();
          if (t) onText(t);
        }
      }
    };
    rec.onend = () => setOn(false);
    rec.onerror = () => setOn(false);
    recRef.current = rec;
    rec.start();
    setOn(true);
  };

  return (
    <button type="button" onClick={toggle} title="음성 받아쓰기"
      className={`min-h-[36px] px-2.5 rounded-full text-sm font-medium ${on ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-100 text-gray-600'}`}>
      {on ? '🎙 듣는 중…' : '🎙 음성'}
    </button>
  );
}
