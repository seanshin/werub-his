'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { PT } from '../_shared/PT';

const TOUR_STEPS = [
  {
    title: '환영합니다!',
    description: '환자 포털에서 진료 예약, 검사 결과, 처방약 관리까지 한 곳에서 관리하세요.',
    icon: '🏥',
    color: 'from-blue-500 to-blue-600',
  },
  {
    title: '5가지 메뉴',
    description: '홈(오늘의 할 일) · 진료(예약/이력) · 건강(검사/투약) · 서비스(수납/서류) · 내 정보',
    icon: '📱',
    color: 'from-indigo-500 to-purple-600',
  },
  {
    title: `${AI_ORIGIN_TEXT} 예약 도우미`,
    description: `증상을 말씀하시면 ${AI_ORIGIN_TEXT}가 적합한 진료과를 추천하고 예약까지 도와드립니다.`,
    icon: '🤖',
    color: 'from-violet-500 to-pink-500',
  },
];

interface OnboardingTourProps {
  onComplete: () => void;
}

export default function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [step, setStep] = useState(0);

  const next = () => {
    if (step < TOUR_STEPS.length - 1) setStep(step + 1);
    else onComplete();
  };

  // 완료·건너뛰기 기록은 부르는 쪽(`onboarding-state.ts` — 계정 단위)이 한다
  const skip = () => onComplete();

  const current = TOUR_STEPS[step];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
        >
          {/* 상단 그라데이션 */}
          <div className={`bg-gradient-to-br ${current.color} p-8 text-center`}>
            <div className="text-5xl mb-3">{current.icon}</div>
            <h2 className="text-xl font-bold text-white">{current.title}</h2>
          </div>

          {/* 설명 */}
          <div className="p-6">
            <p className="text-sm text-gray-600 text-center leading-relaxed">{current.description}</p>

            {/* 진행 도트 */}
            <div className="flex justify-center gap-2 mt-6">
              {TOUR_STEPS.map((_, i) => (
                <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-blue-600' : 'bg-gray-200'}`} />
              ))}
            </div>

            {/* 버튼 */}
            <div className="flex gap-3 mt-6">
              <button onClick={skip} className="flex-1 py-2.5 text-sm text-gray-500 hover:text-gray-700">
                <PT k="건너뛰기" />
              </button>
              <button onClick={next}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
                {step < TOUR_STEPS.length - 1 ? '다음' : '시작하기'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
