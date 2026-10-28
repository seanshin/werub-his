'use client';
import { FinanceBenchmarkCard } from '@/app/(main)/executive/finance-benchmark/FinanceBenchmarkCard';

// 경영성과 벤치마크(의료기관 회계정보공시 손익 · 동급 중앙값 비교) — 상세는 /executive/finance-benchmark
export default function FinanceBenchmarkWidget() {
  return <FinanceBenchmarkCard compact />;
}
