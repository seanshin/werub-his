-- NANDA-I·NIC 마스터 확충 — care-plan 제안 적중률↑. 기존(NANDA_I 30·NIC 25)에 없는 표준코드 보강.
-- 멱등: ON CONFLICT (code_system, code) DO NOTHING.

-- ── NANDA-I 추가(28) ──
INSERT INTO nursing_codes (id, code_system, code, name_ko, name_en, domain, sort_order, is_active) VALUES
 (gen_random_uuid(),'NANDA_I','00001','영양 불균형: 필요량 이상','Imbalanced Nutrition: More Than Body Requirements','영양',100,true),
 (gen_random_uuid(),'NANDA_I','00008','비효과적 체온조절','Ineffective Thermoregulation','안전',101,true),
 (gen_random_uuid(),'NANDA_I','00014','변실금','Bowel Incontinence','배설',102,true),
 (gen_random_uuid(),'NANDA_I','00017','복압성 요실금','Stress Urinary Incontinence','배설',103,true),
 (gen_random_uuid(),'NANDA_I','00020','기능적 요실금','Functional Urinary Incontinence','배설',104,true),
 (gen_random_uuid(),'NANDA_I','00026','체액 과다','Excess Fluid Volume','영양',105,true),
 (gen_random_uuid(),'NANDA_I','00027','체액 부족','Deficient Fluid Volume','영양',106,true),
 (gen_random_uuid(),'NANDA_I','00035','손상 위험','Risk for Injury','안전',107,true),
 (gen_random_uuid(),'NANDA_I','00039','흡인 위험','Risk for Aspiration','안전',108,true),
 (gen_random_uuid(),'NANDA_I','00044','조직통합성 장애','Impaired Tissue Integrity','안전',109,true),
 (gen_random_uuid(),'NANDA_I','00051','언어소통 장애','Impaired Verbal Communication','지각/인지',110,true),
 (gen_random_uuid(),'NANDA_I','00053','사회적 고립','Social Isolation','대인관계',111,true),
 (gen_random_uuid(),'NANDA_I','00061','보호자 역할 부담','Caregiver Role Strain','역할관계',112,true),
 (gen_random_uuid(),'NANDA_I','00069','비효과적 대처','Ineffective Coping','대처/스트레스',113,true),
 (gen_random_uuid(),'NANDA_I','00078','비효과적 건강 자기관리','Ineffective Health Self-Management','건강증진',114,true),
 (gen_random_uuid(),'NANDA_I','00088','보행 장애','Impaired Walking','활동/휴식',115,true),
 (gen_random_uuid(),'NANDA_I','00093','피로','Fatigue','활동/휴식',116,true),
 (gen_random_uuid(),'NANDA_I','00095','불면증','Insomnia','활동/휴식',117,true),
 (gen_random_uuid(),'NANDA_I','00103','연하 장애','Impaired Swallowing','영양',118,true),
 (gen_random_uuid(),'NANDA_I','00118','신체상 장애','Disturbed Body Image','자아인식',119,true),
 (gen_random_uuid(),'NANDA_I','00120','상황적 자존감 저하','Situational Low Self-Esteem','자아인식',120,true),
 (gen_random_uuid(),'NANDA_I','00124','절망감','Hopelessness','대처/스트레스',121,true),
 (gen_random_uuid(),'NANDA_I','00125','무력감','Powerlessness','대처/스트레스',122,true),
 (gen_random_uuid(),'NANDA_I','00134','오심','Nausea','안위',123,true),
 (gen_random_uuid(),'NANDA_I','00179','불안정한 혈당 수치 위험','Risk for Unstable Blood Glucose Level','영양',124,true),
 (gen_random_uuid(),'NANDA_I','00198','수면 양상 장애','Disturbed Sleep Pattern','활동/휴식',125,true),
 (gen_random_uuid(),'NANDA_I','00249','압력손상 위험: 성인','Risk for Adult Pressure Injury','안전',126,true),
 (gen_random_uuid(),'NANDA_I','00214','손상된 안위','Impaired Comfort','안위',127,true)
ON CONFLICT (code_system, code) DO NOTHING;

-- ── NIC 추가(25) ──
INSERT INTO nursing_codes (id, code_system, code, name_ko, name_en, domain, sort_order, is_active) VALUES
 (gen_random_uuid(),'NIC','0180','에너지 관리','Energy Management','생리:기본',200,true),
 (gen_random_uuid(),'NIC','0221','운동요법: 보행','Exercise Therapy: Ambulation','생리:기본',201,true),
 (gen_random_uuid(),'NIC','0224','운동요법: 관절가동성','Exercise Therapy: Joint Mobility','생리:기본',202,true),
 (gen_random_uuid(),'NIC','0226','운동요법: 근육조절','Exercise Therapy: Muscle Control','생리:기본',203,true),
 (gen_random_uuid(),'NIC','0610','요실금 관리','Urinary Incontinence Care','생리:기본',204,true),
 (gen_random_uuid(),'NIC','1100','영양 관리','Nutrition Management','생리:기본',205,true),
 (gen_random_uuid(),'NIC','1450','오심 관리','Nausea Management','생리:기본',206,true),
 (gen_random_uuid(),'NIC','1710','구강건강 유지','Oral Health Maintenance','생리:기본',207,true),
 (gen_random_uuid(),'NIC','1850','수면 증진','Sleep Enhancement','생리:기본',208,true),
 (gen_random_uuid(),'NIC','1860','연하 요법','Swallowing Therapy','생리:복합',209,true),
 (gen_random_uuid(),'NIC','2080','수액/전해질 관리','Fluid/Electrolyte Management','생리:복합',210,true),
 (gen_random_uuid(),'NIC','2120','고혈당 관리','Hyperglycemia Management','생리:복합',211,true),
 (gen_random_uuid(),'NIC','2130','저혈당 관리','Hypoglycemia Management','생리:복합',212,true),
 (gen_random_uuid(),'NIC','2620','신경학적 모니터링','Neurologic Monitoring','생리:복합',213,true),
 (gen_random_uuid(),'NIC','3180','인공기도 관리','Artificial Airway Management','생리:복합',214,true),
 (gen_random_uuid(),'NIC','3350','호흡 모니터링','Respiratory Monitoring','생리:복합',215,true),
 (gen_random_uuid(),'NIC','3500','압력 관리','Pressure Management','생리:복합',216,true),
 (gen_random_uuid(),'NIC','3590','피부 감시','Skin Surveillance','생리:복합',217,true),
 (gen_random_uuid(),'NIC','3740','발열 관리','Fever Treatment','생리:복합',218,true),
 (gen_random_uuid(),'NIC','3900','체온 조절','Temperature Regulation','생리:복합',219,true),
 (gen_random_uuid(),'NIC','4200','정맥요법','Intravenous (IV) Therapy','생리:복합',220,true),
 (gen_random_uuid(),'NIC','4310','활동 요법','Activity Therapy','행동',221,true),
 (gen_random_uuid(),'NIC','5270','정서적 지지','Emotional Support','행동',222,true),
 (gen_random_uuid(),'NIC','5310','희망 고취','Hope Inspiration','행동',223,true),
 (gen_random_uuid(),'NIC','6486','환경 관리: 안전','Environmental Management: Safety','안전',224,true)
ON CONFLICT (code_system, code) DO NOTHING;
