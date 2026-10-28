-- 간호결과(NOC) 표준코드 시드 — care-plan F-2 완성(NANDA-NIC-NOC). 운영 NOC 0건 → 핵심 12종.
-- 멱등: ON CONFLICT (code_system, code) DO NOTHING. care-plan 매처/피커가 마스터에서 선택.
INSERT INTO nursing_codes (id, code_system, code, name_ko, name_en, domain, sort_order, is_active) VALUES
 (gen_random_uuid(), 'NOC', '2102', '통증 수준',                 'Pain Level',                            '안위',   10, true),
 (gen_random_uuid(), 'NOC', '1605', '통증 자가통제',             'Pain Control',                          '안위',   11, true),
 (gen_random_uuid(), 'NOC', '1909', '낙상 발생',                 'Fall Occurrence',                       '안전',   20, true),
 (gen_random_uuid(), 'NOC', '1912', '낙상예방 행위',             'Fall Prevention Behavior',              '안전',   21, true),
 (gen_random_uuid(), 'NOC', '1101', '조직 통합성: 피부 및 점막', 'Tissue Integrity: Skin & Mucous Membranes', '생리',30, true),
 (gen_random_uuid(), 'NOC', '0208', '기동성',                    'Mobility',                              '기능',   40, true),
 (gen_random_uuid(), 'NOC', '0200', '보행',                      'Ambulation',                            '기능',   41, true),
 (gen_random_uuid(), 'NOC', '1004', '영양상태',                  'Nutritional Status',                    '생리',   50, true),
 (gen_random_uuid(), 'NOC', '0415', '호흡상태: 환기',            'Respiratory Status: Ventilation',       '생리',   60, true),
 (gen_random_uuid(), 'NOC', '0402', '호흡상태: 가스교환',        'Respiratory Status: Gas Exchange',      '생리',   61, true),
 (gen_random_uuid(), 'NOC', '0800', '체온조절',                  'Thermoregulation',                      '생리',   70, true),
 (gen_random_uuid(), 'NOC', '0912', '신경학적 상태: 의식',       'Neurological Status: Consciousness',    '생리',   80, true)
ON CONFLICT (code_system, code) DO NOTHING;
