#!/bin/bash
# usage: ./bench.sh <on|off> <template-dir> "<task>" <max_wait_s>
MODE=$1; TEMPLATE=$2; TASK=$3; MAXWAIT=${4:-240}
work=$(mktemp -d); cp -r "$TEMPLATE"/. "$work/" 2>/dev/null
S=bench-$RANDOM
RECAP=/Users/pinion/.pi/agent/npm/node_modules/@npmc_5/pi-recap/index.ts
if [ "$MODE" = "on" ]; then
  PI_FLAGS="--model openrouter/deepseek/deepseek-v4-flash-0731 --session-dir $work/sess -e $RECAP"
else
  PI_FLAGS="--model openrouter/deepseek/deepseek-v4-flash-0731 --session-dir $work/sess --no-extensions"
fi
tmux new-session -d -s $S -c "$work" "pi $PI_FLAGS 2>/dev/null"
sleep 12
tmux send-keys -t $S "$TASK" Enter
# 완료 감지: assistant 턴 수가 3회 연속 동일하면 idle
prev=-1; stable=0
for i in $(seq 1 $((MAXWAIT/8))); do
  sleep 8
  n=$(grep -oh '"role":"assistant"' $work/sess/*.jsonl 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" = "$prev" ]; then stable=$((stable+1)); else stable=0; fi
  prev=$n
  if [ $stable -ge 3 ]; then break; fi
done
tmux kill-session -t $S 2>/dev/null
# 성공 판정
cd "$work" && node --test >/dev/null 2>&1; PASS=$?
# 측정
python3 - "$MODE" "$PASS" "$work" <<'PY'
import json, glob, sys
mode, pass_, work = sys.argv[1], int(sys.argv[2]), sys.argv[3]
tin=tout=tcache=turns=recaps=swaps=0
for f in glob.glob(work+'/sess/*.jsonl'):
    for l in open(f):
        try: d=json.loads(l)
        except: continue
        if d.get('type')=='message' and d.get('message',{}).get('role')=='assistant':
            u=d['message'].get('usage',{}); turns+=1
            tin+=u.get('input',0); tout+=u.get('output',0); tcache+=u.get('cacheRead',0)
        if d.get('type')=='custom' and d.get('customType')=='recap-entry': recaps+=1
        if '"customType":"recap-message"' in l: swaps+=1
print(json.dumps({'mode':mode,'success':pass_==0,'turns':turns,'input':tin,'output':tout,'cacheRead':tcache,'recaps':recaps,'swaps':swaps}))
PY
rm -rf "$work"
