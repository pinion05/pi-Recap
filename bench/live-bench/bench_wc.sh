#!/bin/bash
# usage: ./bench_wc.sh <on|off> <max_wait_s>
MODE=$1; MAXWAIT=${2:-900}
TEMPLATE=/tmp/tbench-write-comp
work=$(mktemp -d); cp -r "$TEMPLATE"/. "$work/"
S=wc-$RANDOM
RECAP=/Users/pinion/.pi/agent/npm/node_modules/@npmc_5/pi-recap/index.ts
if [ "$MODE" = "on" ]; then
  PI_FLAGS="--model openrouter/deepseek/deepseek-v4-flash-0731 --session-dir $work/sess -e $RECAP"
else
  PI_FLAGS="--model openrouter/deepseek/deepseek-v4-flash-0731 --session-dir $work/sess --no-extensions"
fi
tmux new-session -d -s $S -c "$work" "pi $PI_FLAGS 2>/dev/null"
sleep 12
INSTR=$(cat "$TEMPLATE/instruction.md")
tmux send-keys -t $S "$INSTR" Enter
# 완료 감지: assistant 턴 3회 연속 안 늘면 idle
prev=-1; stable=0
for i in $(seq 1 $((MAXWAIT/10))); do
  sleep 10
  n=$(grep -oh '"role":"assistant"' $work/sess/*.jsonl 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" = "$prev" ]; then stable=$((stable+1)); else stable=0; fi
  prev=$n
  if [ $stable -ge 30 ]; then break; fi
done
tmux kill-session -t $S 2>/dev/null
# 검증 (test_outputs.py 로직): data.comp 존재 + cat|decomp==data.txt + ≤2500
cd "$work"
ok=0
if [ -f data.comp ]; then
  sz=$(wc -c < data.comp | tr -d ' ')
  if [ "$sz" -le 2500 ]; then
    cat data.comp | ./decomp > /tmp/wc_out 2>/dev/null
    if diff /tmp/wc_out data.txt >/dev/null 2>&1; then ok=1; fi
  fi
fi
python3 - "$MODE" "$ok" "$work" <<'PY'
import json, glob, sys
mode, ok, work = sys.argv[1], int(sys.argv[2]), sys.argv[3]
tin=tout=tcache=turns=recaps=0
for f in glob.glob(work+'/sess/*.jsonl'):
    for l in open(f):
        try: d=json.loads(l)
        except: continue
        if d.get('type')=='message' and d.get('message',{}).get('role')=='assistant':
            u=d['message'].get('usage',{}); turns+=1
            tin+=u.get('input',0); tout+=u.get('output',0); tcache+=u.get('cacheRead',0)
        if d.get('type')=='custom' and d.get('customType')=='recap-entry': recaps+=1
import subprocess
print(json.dumps({'mode':mode,'success':ok==1,'turns':turns,'input':tin,'output':tout,'cacheRead':tcache,'recaps':recaps,'workdir':work}))
PY
# workdir 보존 (로그 분석용, 삭제 안 함)
echo "workdir 보존: $work"
