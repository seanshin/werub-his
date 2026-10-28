-- UI 크롬 언어(ui-locale-i18n P0) — additive·비파괴. 운영 적용: psql 직접 실행 후 prisma generate.
ALTER TABLE user_ui_preferences ADD COLUMN IF NOT EXISTS ui_locale VARCHAR(8);
