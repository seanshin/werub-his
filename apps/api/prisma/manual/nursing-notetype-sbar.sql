-- NursingNoteType 에 SBAR 추가(기존 작성기 SBAR 모드가 enum 부재로 저장 400이던 버그 해소). 비파괴 additive.
ALTER TYPE "NursingNoteType" ADD VALUE IF NOT EXISTS 'SBAR';
