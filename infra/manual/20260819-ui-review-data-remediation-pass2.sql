-- 2026-08-19 데이터 교정 2차 — 산문형 PHI
--
-- 🔴 1차는 템플릿 카드(`알레르기:` 콜론형)만 잡았다. 그리고 사후 확인을 UPDATE 와 **같은 패턴**으로
--    해서 "완료"라고 말했는데, LLM 이 산문으로 다시 말한 5건이 남아 있었다:
--      "김영수님, 안녕하세요. 1958년생 남자분이시죠. 페니실린과 땅콩 알레르기가 있으신…"
--    이름+생년+알레르기+진단명이 한 문장에 있어 템플릿보다 더 나쁘다.
--    🔴 교훈: **검사는 고친 것과 다른 기준으로 해야 한다.**
--
-- 대상: 환자에 결속된 공개(WEB_BOOKING) 세션의 메시지 중 임상 어휘가 있는 것.
-- 산문은 정규식으로 안전하게 좁힐 수 없으므로 **넓게 잡는다**(모르면 안전측으로 접는다).
BEGIN;

UPDATE agent_sessions
   SET messages = (
         SELECT jsonb_agg(
           CASE WHEN m->>'content' ~ '(알레르기|고혈압|당뇨|천식|심부전|협심증|뇌졸중|투석|정신|우울|불안|처방|복용|진단|병력|앓고|앓으)'
                THEN jsonb_set(m, '{content}',
                     to_jsonb('[임상정보 삭제됨 — 무인증 채널 노출분 2026-08-19 정리]'::text))
                ELSE m END
           ORDER BY ord)
         FROM jsonb_array_elements(messages) WITH ORDINALITY AS t(m, ord)
       )
 WHERE channel = 'WEB_BOOKING'
   AND patient_id IS NOT NULL
   AND jsonb_typeof(messages) = 'array'
   AND messages::text ~ '(알레르기|고혈압|당뇨|천식|심부전|협심증|뇌졸중|투석|처방|복용|진단|병력|앓고|앓으)';

COMMIT;
