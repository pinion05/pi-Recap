import { createAgentSession, DefaultResourceLoader, SessionManager, getAgentDir } from "/Users/pinion/.nvm/versions/node/v24.13.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const cwd = process.argv[2];
const task = process.argv[3];
const mode = process.argv[4] || "on";
const RECAP = "/Users/pinion/.pi/agent/npm/node_modules/@npmc_5/pi-recap/index.ts";

const loader = new DefaultResourceLoader({
	agentDir: getAgentDir(),
	cwd,
	additionalExtensionPaths: mode === "on" ? [RECAP] : [],
});
await loader.reload();

const { session, extensionsResult } = await createAgentSession({
	resourceLoader: loader,
	sessionManager: SessionManager.inMemory(),
	cwd,
});
const extNames = extensionsResult?.extensions?.map((e: any) => e.name || e.id).filter(Boolean) || [];
console.error("LOADED_EXTENSIONS:", JSON.stringify(extNames));
if (extensionsResult?.errors?.length) console.error("EXT_ERRORS:", JSON.stringify(extensionsResult.errors));

let recaps = 0, tin = 0, tout = 0, tcache = 0, turns = 0, ctxEvents = 0;
const types: Record<string, number> = {};
session.subscribe((e: any) => {
	types[e.type] = (types[e.type] || 0) + 1;
	if (e.type === "context") ctxEvents++;
	if (e.type === "turn_end") {
		turns++;
		const u = e.message?.usage || {};
		tin += u.input || 0; tout += u.output || 0; tcache += u.cacheRead || 0;
	}
	if (e.type === "custom" && e.customType === "recap-entry") recaps++;
});

await session.prompt(task);
session.dispose();
console.log(JSON.stringify({ mode, turns, input: tin, output: tout, cacheRead: tcache, recaps_made: recaps, ctxEvents, eventTypes: types }));
process.exit(0);
