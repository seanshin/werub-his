#!/usr/bin/env bash
# 배치중립 N2 tier 게이트 — location-free 화이트리스트 모듈이 환자 스코프(PHI) 모델을
# 직접 참조하면 실패. tier 매니페스트(docs/05-reference/module-tier-manifest.md) 동결.
set -u
WHITELIST="config i18n holiday hospital-info homepage-popup cms-config code-master reference-range access-control fee-integration text-macro form-engine"
PHI_RE="prisma\.(patient|encounter|prescription|admission|consent|labResult|billing)\b"
BASE="apps/api/src/modules"
fail=0
for mod in $WHITELIST; do
  d="$BASE/$mod"
  [ -d "$d" ] || continue
  hits=$(grep -rEl "$PHI_RE" "$d" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "❌ tier(N2) 위반: location-free 모듈 '$mod' 이 PHI 모델 참조"
    echo "$hits" | sed 's/^/     /'
    fail=1
  fi
done
if [ "$fail" -eq 0 ]; then
  echo "✅ tier(N2) 게이트 PASS — location-free 화이트리스트 $(echo $WHITELIST | wc -w | tr -d ' ')종 PHI 무참조"
fi
exit $fail
