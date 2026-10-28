# shellcheck shell=bash
# ============================================================================
# 빌드 메모리 판정 — install.sh 가 source 한다(2026-09-14)
#
# 🔴 왜: 리허설에서 빌드가 **조용히 137(OOM 강제 종료)** 로 죽었다 — `nest build` 는 Node 기본 힙에서, 웹 `next build` 는
#    8GB 컨테이너에서. 설치자는 "빌드 실패"만 보고 원인이 메모리인지 알 수 없었다.
#    → 빌드 **전에** 가용 메모리를 재고, 모자라면 이유와 숫자를 말하고 멈춘다. 힙은 가용 메모리에서 정한다.
#
# 🔴 모르면 막지 않는다 — 가용 메모리를 잴 수 없으면(비 Linux 등) 경고만 하고 기존 힙 기본값으로 진행한다
#    (잴 수 없다는 사실로 설치를 막으면 방치된다 · 다만 조용히 넘기지 않는다).
# 실측 근거: docs/05-reference/customer-install-guide.md §2 메모리(컨테이너 cgroup memory.peak).
# ============================================================================

# his_mem_available_mb — 이 프로세스가 더 쓸 수 있는 메모리(MB). cgroup 한도가 있으면 (한도 − 현재 사용), 없으면 MemAvailable.
#                        둘 다 있으면 작은 값. 잴 수 없으면 빈 문자열(0 이 아니다 — 0 은 "없다"는 사실이다).
#   테스트 주입: HIS_MEM_CGROUP_DIR(기본 /sys/fs/cgroup) · HIS_MEM_MEMINFO(기본 /proc/meminfo)
his_mem_available_mb() {
  local cg="${HIS_MEM_CGROUP_DIR:-/sys/fs/cgroup}" mi="${HIS_MEM_MEMINFO:-/proc/meminfo}"
  local lim="" cur="" cgav="" avail="" v
  if [ -r "${cg}/memory.max" ]; then
    v="$(tr -d '[:space:]' < "${cg}/memory.max")"
    case "$v" in ''|max|*[!0-9]*) ;; *) lim="$v" ;; esac
    [ -n "$lim" ] && [ -r "${cg}/memory.current" ] && cur="$(tr -d '[:space:]' < "${cg}/memory.current")"
  elif [ -r "${cg}/memory/memory.limit_in_bytes" ]; then
    v="$(tr -d '[:space:]' < "${cg}/memory/memory.limit_in_bytes")"
    # cgroup v1 의 "무제한"은 페이지 크기로 내림한 거대한 수다 — 1TB 넘으면 한도 없음으로 본다
    case "$v" in ''|*[!0-9]*) ;; *) [ "${#v}" -le 13 ] && lim="$v" ;; esac
    [ -n "$lim" ] && [ -r "${cg}/memory/memory.usage_in_bytes" ] && cur="$(tr -d '[:space:]' < "${cg}/memory/memory.usage_in_bytes")"
  fi
  if [ -n "$lim" ]; then
    case "$cur" in ''|*[!0-9]*) cur=0 ;; esac
    cgav=$(( (lim - cur) / 1048576 ))
  fi
  [ -r "$mi" ] && avail="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' "$mi")"
  if [ -n "$cgav" ] && [ -n "$avail" ]; then
    [ "$cgav" -lt "$avail" ] && echo "$cgav" || echo "$avail"
  elif [ -n "$cgav" ]; then echo "$cgav"
  elif [ -n "$avail" ]; then echo "$avail"
  fi
}

# his_build_heap_mb <available_mb|""> <need_mb> <max_heap_mb> — 힙 크기(MB). 가용이 모르면 max_heap 그대로.
#   가용의 75% 를 넘기지 않는다(빌드는 V8 힙 밖에서도 쓴다 — 타입 검사 워커·네이티브 버퍼), 상한 max_heap.
his_build_heap_mb() {
  local avail="$1" max_heap="$3" h
  [ -z "$avail" ] && { echo "$max_heap"; return 0; }
  h=$(( avail * 3 / 4 ))
  [ "$h" -gt "$max_heap" ] && h="$max_heap"
  echo "$h"
}
