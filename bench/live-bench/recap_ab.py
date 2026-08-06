import json, re, time, os
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request

API = 'https://api.deepseek.com/v1/chat/completions'
KEY = json.load(open(os.path.expanduser('~/.pi/agent/auth.json')))['deepseek']['key']
MODEL = 'deepseek-v4-flash'
triples = json.load(open('/tmp/recap_triples.json'))

PROMPTS = {
'baseline': lambda i, tn: f"""Above is the full conversation so far, including a tool result you just received.
Summarize the tool result with toolCallId `{i}` (tool: {tn}) in 1–3 lines, for your own future use in this task.
Keep only what the ongoing work still needs: outcomes, file paths, key values, errors. Omit code blocks, logs, and filler — the original is recoverable on demand.
Reply with ONLY the 1–3 summary lines.""",
'A_identifiers': lambda i, tn: f"""Above is the full conversation so far, including a tool result you just received.
Summarize the tool result with toolCallId `{i}` (tool: {tn}) for your own future use.
PRIORITIZE exact identifiers the work may touch: file paths, function/constant/variable names, config values, precise numbers, error strings. Keep these VERBATIM even at the cost of prose. Omit only code blocks and verbose logs.
Reply with ONLY 1–3 lines.""",
'B_serendip': lambda i, tn: f"""Above is the full conversation so far, including a tool result you just received.
Summarize the tool result with toolCallId `{i}` (tool: {tn}) for your own future use.
Keep what the ongoing work needs — outcomes, file paths, key values, errors — AND any surprising detail a large result happened to surface that could matter later: an unexpected file, an odd value, a latent clue. Keep exact identifiers verbatim. Drop prose and verbose logs.
Reply with ONLY 1–3 lines (4 if a large result surfaced genuinely useful extras).""",
'C_strategic': lambda i, tn: f"""Above is the full conversation so far, including a tool result you just received.
Summarize the tool result with toolCallId `{i}` (tool: {tn}) for your own future use.
1) Identify the single task in progress right now.
2) Keep EVERY exact identifier the task may touch: file paths, function/constant/variable names, config values, precise numbers, error strings — verbatim.
3) Keep the outcome (pass/fail, result, count).
4) If space remains, note 1–2 unexpected-but-plausibly-relevant details a large result surfaced.
Length: 1–3 lines normally; up to 5 lines for large results (>5K chars) so nothing task-critical is lost.""",
}

def llm(msgs, mt=800):
    body = json.dumps({'model': MODEL, 'messages': msgs, 'max_tokens': mt, 'temperature': 0}).encode()
    req = urllib.request.Request(API, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())['choices'][0]['message'].get('content', '')
        except Exception as e:
            time.sleep(3*(a+1)); err=str(e)[:60]
    return f'__ERR__{err}'

def summarize(t, key):
    instr = PROMPTS[key](t['tcid'], t['tool'])
    user = f"{instr}\n\n--- 직전 에이전트 의도 ---\n{t.get('prior','')}\n\n--- tool 결과 (toolCallId {t['tcid']}, tool {t['tool']}) ---\n{t['orig'][:6000]}"
    return llm([{'role': 'user', 'content': user}], mt=800).strip()

def judge(t, recap):
    p = f"""당신은 코딩 에이전트의 tool 결과 요약(recap) 품질 평가자.

[기준] 절대적 정보량이 아니라 **이후 에이전트가 작업에 실제로 필요로 한 정보**가 보존되었는지.

[TOOL 원본 결과]
{json.dumps(t['orig'][:6000], ensure_ascii=False)}

[에이전트 후속 행동 — 이 결과 받고 직후에 한 것]
{json.dumps(t['followup'][:1500], ensure_ascii=False)}

[분신이 만든 recap]
{json.dumps(recap, ensure_ascii=False)}

[평가]
1. <후속 행동>을 보고 에이전트가 이 결과에서 실제로 의존한 정보 단위를 1~5개 식별 (task-relevant만).
2. 각 단위가 <recap>에 보존되었는지: preserved / partial / lost.
3. JSON만 출력:
{{"units":[{{"info":"...","status":"preserved|partial|lost"}}]}}"""
    c = llm([{'role': 'user', 'content': p}], mt=6000)
    m = re.search(r'\{.*\}', c, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            # info 필드 따옴표 등 파싱 실패 → 빈 units (통계에서 제외)
            return {'units': [], 'parse_fail': c[:120]}
    return {'units': [], 'raw': c[:120]}

# ---- Phase 1: summarize (4 prompts × 73) ----
SCKPT = '/tmp/recap_ab_summaries.json'
summaries = json.load(open(SCKPT)) if os.path.exists(SCKPT) else {}
keys = list(PROMPTS)
todo = [(t['tcid'], k) for t in triples for k in keys if summaries.get(t['tcid'], {}).get(k) is None]
print(f'Phase1 요약: {len(todo)} 남음 (전체 {len(triples)*4})')
def sjob(job):
    tcid, k = job
    t = next(x for x in triples if x['tcid'] == tcid)
    return tcid, k, summarize(t, k)
with ThreadPoolExecutor(max_workers=10) as ex:
    futs = {ex.submit(sjob, j): j for j in todo}
    for i, fu in enumerate(as_completed(futs), 1):
        tcid, k, rec = fu.result()
        summaries.setdefault(tcid, {})[k] = rec
        if i % 40 == 0:
            json.dump(summaries, open(SCKPT, 'w'), ensure_ascii=False)
            print(f'  요약 {i}/{len(todo)}')
json.dump(summaries, open(SCKPT, 'w'), ensure_ascii=False)

# ---- Phase 2: judge (4 × 73) ----
JCKPT = '/tmp/recap_ab_judged.json'
judged = json.load(open(JCKPT)) if os.path.exists(JCKPT) else {}
todo = [(t['tcid'], k) for t in triples for k in keys if judged.get(t['tcid'], {}).get(k) is None]
print(f'Phase2 평가: {len(todo)} 남음')
def jjob(job):
    tcid, k = job
    t = next(x for x in triples if x['tcid'] == tcid)
    rec = summaries[tcid][k]
    return tcid, k, judge(t, rec)
with ThreadPoolExecutor(max_workers=10) as ex:
    futs = {ex.submit(jjob, j): j for j in todo}
    for i, fu in enumerate(as_completed(futs), 1):
        tcid, k, res = fu.result()
        judged.setdefault(tcid, {})[k] = res
        if i % 40 == 0:
            json.dump(judged, open(JCKPT, 'w'), ensure_ascii=False)
            print(f'  평가 {i}/{len(todo)}')
json.dump(judged, open(JCKPT, 'w'), ensure_ascii=False)

# ---- 집계 ----
def bucket(n): return '소' if n < 1000 else ('중' if n < 5000 else '대')
print('\n================ A/B/C/D 결과 (task-grounded recall) ================')
print(f'{"프롬프트":<16}{"overall":>10}{"소(<1K)":>10}{"중(1-5K)":>10}{"대(5K+)":>10}{"lost%":>8}')
best = None
for k in keys:
    P = part = larg = tot = pres = par = lost = 0
    by = {'소': [0,0], '중': [0,0], '대': [0,0]}
    for t in triples:
        res = judged.get(t['tcid'], {}).get(k, {})
        for u in res.get('units', []):
            s = u.get('status', 'lost'); tot += 1
            b = bucket(t['olen']); by[b][1] += 1
            if s == 'preserved': pres += 1; by[b][0]+=1
            elif s == 'partial': par += 1; by[b][0]+=0.5
            else: lost += 1
    if tot == 0:
        print(f'{k:<16}  (데이터 없음)'); continue
    recall = (pres+0.5*par)/tot
    r = {b:(by[b][0]/by[b][1]*100 if by[b][1] else 0) for b in by}
    print(f'{k:<16}{recall*100:>9.1f}%{r["소"]:>9.1f}%{r["중"]:>9.1f}%{r["대"]:>9.1f}%{lost/tot*100:>7.1f}%')
    if best is None or recall > best[1]:
        best = (k, recall)
print(f'\n→ 최고: {best[0]} ({best[1]*100:.1f}%)')

# 길이 분포 (프롬프트별 평균 recap 길이)
print('\n== 평균 recap 길이 (자) ==')
for k in keys:
    lens = [len(summaries[t['tcid']][k]) for t in triples]
    print(f'  {k:<16} {sum(lens)/len(lens):.0f}')
