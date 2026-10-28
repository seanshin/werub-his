-- 원무 업무 매뉴얼(/custom/manual) 골격 템플릿 시드 — 관리자가 편집으로 살 채움
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: ON CONFLICT 로 멱등. HTML 은 FE 에서 sanitizeHtml 렌더(속성 없는 기본 태그만 사용).
INSERT INTO system_configs (id, key, value, category, label, updated_at)
VALUES (
  gen_random_uuid(),
  'access.custom-page.manual',
  $j${"title":"원무 업무 매뉴얼","content":"<p>본 매뉴얼은 골격(템플릿)입니다. 관리자는 우측 상단 <b>편집</b>으로 각 항목을 병원 실무에 맞게 보완하세요.</p><hr><h2>1. 접수</h2><h3>1.1 외래 접수</h3><ul><li>신규/재진 구분, 본인확인(신분증·주민번호), 진료과·의사 선택</li><li>초진 동의·문진표 안내</li></ul><h3>1.2 입원 접수</h3><ul><li>입원 수속, 병동·병상 배정, 보호자 등록</li></ul><h3>1.3 응급 접수</h3><ul><li>응급 미확인 등록(신원 미상 대응), KTAS 연계</li></ul><h2>2. 수납·정산</h2><ul><li>진료비 수납(현금·카드), 중간정산, 퇴원정산</li><li>환불 처리 절차 및 승인 권한</li><li>영수증·세부내역서 발급</li></ul><h2>3. 보험·청구</h2><ul><li>수진자 자격조회(공단), 급여/비급여 구분</li><li>본인부담률(차상위·의료급여·산정특례) 적용</li><li>공단 청구(EDI) 및 심사 대응</li></ul><h2>4. 서류·증명서 발급</h2><ul><li>의무기록 사본: 환자 포털 신청 → 서류 발급 워크스테이션에서 검토·발급</li><li>진단서·소견서: 진단서 워크스테이션에서 담당의 작성·전자서명·발급(의료법 §17)</li><li>본인/대리인 자격 확인, 수수료 안내, 수령 방법(포털 다운로드·방문)</li></ul><h2>5. 환자 안내</h2><ul><li>대기 안내, 진료과·검사실 위치, 편의시설</li><li>비대면진료·예약 변경 안내</li></ul><h2>6. 응대 FAQ</h2><ul><li>(질문) ... (답변) ...</li><li>(질문) ... (답변) ...</li></ul><hr><p><i>최종 업데이트 책임: 원무팀 / 관리자. 변경 시 본 페이지를 편집하세요.</i></p>"}$j$::jsonb,
  'access',
  '커스텀 페이지: manual',
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
