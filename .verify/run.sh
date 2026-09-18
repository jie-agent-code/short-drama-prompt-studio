#!/usr/bin/env bash
# 统一运行 .verify 下的验证脚本。
#
# 为什么需要：app/lib 内部的相对引用省略了扩展名（from './state'），
# Node 直跑 .ts/.mts 时无法解析——Next 的打包器可以，但 Node 不行。
# 所有脚本统一带上 resolve-hook 即可，不必每次手写参数。
#
# 用法：
#   bash .verify/run.sh                 # 跑全部单元测试
#   bash .verify/run.sh auditor         # 只跑匹配 auditor 的脚本
set -u
cd "$(dirname "$0")/.." || exit 1

NODE="C:\\Users\\Administrator\\.workbuddy-ai\\binaries\\node\\versions\\22.22.2-2\\node.exe"
FILTER="${1:-}"
SUITES="auditor.unit.mts direction.unit.mts lead-order.unit.mts lead-audit.unit.mts agent.unit.mts narrative.unit.mts hook.unit.mts override.unit.mts duration.unit.mts coverage.unit.mts"

total_pass=0
total_fail=0
failed_suites=""

for f in $SUITES; do
  if [ -n "$FILTER" ] && ! echo "$f" | grep -q "$FILTER"; then continue; fi
  if [ ! -f ".verify/$f" ]; then continue; fi
  out=$("$NODE" --experimental-strip-types --import ./.verify/register-hook.mjs ".verify/$f" 2>&1 \
        | grep -vE "ExperimentalWarning|trace-warnings|MODULE_TYPELESS|Reparsing|performance overhead|eliminate this warning|^$")
  line=$(echo "$out" | grep -E "通过 /" | tail -1)
  if echo "$line" | grep -qE "：[0-9]+ 通过 / [0-9]+ 失败"; then
    p=$(echo "$line" | sed -E 's/.*：([0-9]+) 通过.*/\1/')
    fl=$(echo "$line" | sed -E 's/.*通过 \/ ([0-9]+) 失败.*/\1/')
    total_pass=$((total_pass + p))
    total_fail=$((total_fail + fl))
    if [ "$fl" -gt 0 ]; then
      failed_suites="$failed_suites $f"
      echo "$out" | grep -E "^FAIL" -A 2
    fi
    echo "$(printf '%-24s' "$f") $line"
  else
    total_fail=$((total_fail + 1))
    failed_suites="$failed_suites $f(异常)"
    echo "$(printf '%-24s' "$f") 执行异常"
    echo "$out" | tail -5
  fi
done

echo ""
echo "==================================="
echo "合计：$total_pass 通过 / $total_fail 失败"
if [ -n "$failed_suites" ]; then echo "失败套件：$failed_suites"; fi
[ "$total_fail" -eq 0 ]
