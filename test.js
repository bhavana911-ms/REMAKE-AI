const { spawn } = require("child_process");
const srv = spawn("node", ["server.js"], { env: { ...process.env, PORT: 3456 } });
const rpc = (method, params, id = 1) => fetch("http://127.0.0.1:3456/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }).then((r) => r.json());
setTimeout(async () => {
  let fail = 0; const check = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fail++; };
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  check("initialize", init.result?.serverInfo?.name === "remake-ai");
  const list = await rpc("tools/list", {});
  check("10 tools listed", list.result?.tools?.length === 10);
  const samples = { describe_item_and_problem: { item: "mixer grinder", symptoms: "loud noise, leaking" }, get_follow_up_questions: { item: "kettle", symptoms: "not heating" }, search_repair_references: { item: "Philips iron" }, search_reference_images: { query: "zipper slider" }, generate_appliance_repair_plan: { item: "fan", symptoms: "loud noise" }, generate_clothing_repair_ideas: { garment: "jeans", damage: "hole at knee" }, generate_upcycling_ideas: { garment: "old jeans" }, generate_step_by_step_guide: { project: "tote bag", steps: 5 }, estimate_repair_or_project_cost: { item: "mixer", issue: "motor" }, find_professional_repair_options: { item: "washing machine", location: "New Delhi" } };
  for (const [name, args] of Object.entries(samples)) { const r = await rpc("tools/call", { name, arguments: args }, 2); check("tool " + name, r.result && !r.result.isError && JSON.parse(r.result.content[0].text)); }
  const html = await fetch("http://127.0.0.1:3456/").then((r) => r.text()); check("serves site", html.includes("RE:MAKE AI"));
  for (const f of ["app.js","styles.css","tailwind-config.js"]) { const r = await fetch("http://127.0.0.1:3456/" + f); check("serves " + f, r.status === 200 && (await r.text()).length > 20); }
  check("blocks path traversal", (await fetch("http://127.0.0.1:3456/..%2fserver.js")).status === 404);
  srv.kill(); process.exit(fail ? 1 : 0);
}, 700);
