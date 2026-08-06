import sys, subprocess, json, shutil, tempfile

MODE = sys.argv[1]  # "off" or "on"
TEMPLATE = '/tmp/bench-big'
PROMPT = sys.argv[2] if len(sys.argv) > 2 else "All tests in this repo fail. Read big.js to find the 8 bugs, fix each so every test passes. Run the tests to verify all pass."

work = tempfile.mkdtemp(prefix='bench-')
shutil.copytree(TEMPLATE, work, dirs_exist_ok=True)
RECAP = '/Users/pinion/.pi/agent/npm/node_modules/@npmc_5/pi-recap'
ext_flags = ['--no-extensions'] if MODE == 'off' else ['--no-extensions', '-e', RECAP]
cmd = ['pi', '-p', '--mode', 'json', '--no-skills', '--no-prompt-templates',
       '--no-session', '--model', 'deepseek/deepseek-v4-flash'] + ext_flags + [PROMPT]

p = subprocess.run(cmd, capture_output=True, text=True, timeout=900, cwd=work)
jsonl = p.stdout

# 성공 판정: node --test exit code
t = subprocess.run(['node', '--test'], cwd=work, capture_output=True)
success = (t.returncode == 0)

# usage 합산 + recap 로드 여부
turns = 0; tin = tout = tcache = tcost = 0; recaps = 0
for l in jsonl.splitlines():
    l = l.strip()
    if not l: continue
    try: d = json.loads(l)
    except: continue
    if d.get('type') == 'turn_end':
        u = d.get('message', {}).get('usage', {})
        turns += 1; tin += u.get('input', 0); tout += u.get('output', 0)
        tcache += u.get('cacheRead', 0); tcost += u.get('cost', {}).get('total', 0)
    if d.get('customType') == 'recap-entry': recaps += 1

r = {'mode': MODE, 'success': success, 'turns': turns,
     'input': tin, 'output': tout, 'cacheRead': tcache,
     'cost_total_usd': round(tcost, 5), 'recaps_made': recaps}
print(json.dumps(r, ensure_ascii=False))
shutil.rmtree(work, ignore_errors=True)
