/**
 * 병상 표식 정본(2026-10-02 · 통합 상황판 3D 병상) — 3D 장면과 옆 목록이 같은 색·같은 어휘를 쓴다.
 * 🔴 three.js 를 import 하지 않는 가벼운 모듈이어야 한다 — 상황판이 이것을 정적으로 가져가도 3D 는 열 때만 내려받게.
 */
export type BedMark = 'OCCUPIED' | 'AVAILABLE' | 'RESERVED' | 'CLEANING' | 'MAINTENANCE' | 'ISOLATION' | 'MISMATCH';

/** 점유 보라 · 빈 병상 초록 · 청소 노랑 · 예약 파랑 · 정비/격리 회색 · 상태 불일치 빨강 */
export const BED_COLOR: Record<BedMark, string> = {
  OCCUPIED: '#7c3aed', AVAILABLE: '#22c55e', RESERVED: '#3b82f6', CLEANING: '#eab308', MAINTENANCE: '#94a3b8', ISOLATION: '#64748b', MISMATCH: '#ef4444',
};
