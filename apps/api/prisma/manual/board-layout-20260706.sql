-- 큰 화면 보기(board) 개인 레이아웃 서버 동기화 — 2026-07-06 (멱등)
-- UserChartPreference.boardLayout(JsonB nullable) 추가. 데이터 손실 없음.
ALTER TABLE user_chart_preferences ADD COLUMN IF NOT EXISTS board_layout JSONB;
