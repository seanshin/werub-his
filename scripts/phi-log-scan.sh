#!/bin/bash
# 로그 PHI 노출 스캔 — 로거/콘솔에 환자 직접 식별자가 보간되는지 검출.
# 2026-07 로그 PHI 전수검토. 재실행: bash scripts/phi-log-scan.sh
# (직원 이메일은 인증 추적 목적·환자 PHI 아님 → 별도 취급. 환자 이름·전화·주민번호가 핵심.)
SRC="apps/api/src"
echo "== 환자 직접 식별자 로깅(이름·전화·주민번호·여권·생년월일) =="
grep -rnoE "(logger\.(log|error|warn|debug|verbose)|console\.(log|error|warn))\([^;]{0,160}\b(residentNumber|ssn|nationalId|passportNumber|\.phone\b|familyName|givenName|patientName|chartNo|dateOfBirth)\b" "$SRC" --include="*.ts" \
  | grep -viE "spec|// PHI:|미설정|없음|설정|게이트|가명화|컷오버" \
  | sed 's|apps/api/src/modules/||'
echo
echo "== 환자/DTO 객체 통째 로깅 =="
grep -rnoE "(logger\.\w+|console\.\w+)\(\s*(JSON\.stringify\()?\s*(patient|dto|body|payload)\s*\)?" "$SRC" --include="*.ts" | grep -v spec | sed 's|apps/api/src/modules/||'
echo
echo "(둘 다 비면 환자 PHI 로그 노출 없음)"
