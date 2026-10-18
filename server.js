// RE:MAKE AI - MCP server (zero dependencies, Node >= 18)
// Transports: Streamable HTTP at POST /mcp (default) or stdio with `node server.js --stdio`.
// Also serves the RE:MAKE AI web app at "/".
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

// ---------- helpers ----------
const enc = encodeURIComponent;
const has = (s, ...w) => w.some((x) => String(s || "").toLowerCase().includes(x));
function detectCategory(item = "", category = "") {
  if (category) return category.toLowerCase();
  if (has(item, "shirt", "jean", "jacket", "dress", "saree", "kurta", "sweater", "trouser", "pant", "sock", "coat", "hoodie")) return "clothing";
  return "appliance";
}
async function gemini(prompt) {
  if (!GEMINI_KEY) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch { return null; }
}
const text = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

// ---------- tool implementations ----------
const S = (props, required) => ({ type: "object", properties: props, required });
const str = (d) => ({ type: "string", description: d });

const tools = [
  {
    name: "describe_item_and_problem",
    description: "Captures and normalizes the user's item, category, symptoms, and image info.",
    inputSchema: S({ item: str("Item name, e.g. 'mixer grinder'"), category: str("appliance or clothing (optional)"), symptoms: str("What is wrong"), image_info: str("Optional description of an uploaded photo") }, ["item", "symptoms"]),
    run: ({ item, category, symptoms, image_info = "" }) => ({
      item: item.trim(), category: detectCategory(item, category),
      symptoms: String(symptoms).split(/[,.;\n]+/).map((s) => s.trim()).filter(Boolean),
      image_info: image_info || null,
    }),
  },
  {
    name: "get_follow_up_questions",
    description: "Generates item-specific diagnostic follow-up questions.",
    inputSchema: S({ item: str("Item name"), category: str("appliance or clothing"), symptoms: str("Reported symptoms") }, ["item", "symptoms"]),
    run: async ({ item, category, symptoms }) => {
      const cat = detectCategory(item, category);
      const ai = await gemini(`Give 4 short diagnostic follow-up questions for a ${item} with this problem: ${symptoms}. Return one question per line, no numbering.`);
      if (ai) return { source: "gemini", questions: ai.split("\n").map((q) => q.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean).slice(0, 5) };
      const base = cat === "clothing"
        ? ["What is the fabric (cotton, denim, wool, silk, synthetic)?", "How large is the damage and where is it located (seam, knee, hem, zipper)?", "Is the surrounding fabric thin or weak?", "Do you have a sewing machine, or will this be hand-sewn?"]
        : ["Does the item power on at all (lights, sounds, motor hum)?", "When did the problem start and did anything happen just before (drop, spill, power surge)?", "Have you checked the plug, socket, fuse and cable?", "Is it still under warranty, and how old is it?"];
      return { source: "built-in", questions: base };
    },
  },
  {
    name: "search_repair_references",
    description: "Returns official manual and troubleshooting guide links for the item.",
    inputSchema: S({ item: str("Item name or model"), symptoms: str("Problem keywords (optional)") }, ["item"]),
    run: ({ item, symptoms = "" }) => {
      const q = `${item} ${symptoms}`.trim();
      return { references: [
        { title: "iFixit repair guides", url: `https://www.ifixit.com/Search?query=${enc(item)}` },
        { title: "iFixit Answers (community troubleshooting)", url: `https://www.ifixit.com/Answers/Search?query=${enc(q)}` },
        { title: "Official manual search", url: `https://www.google.com/search?q=${enc(item + " official user manual pdf")}` },
        { title: "Video tutorials", url: `https://www.youtube.com/results?search_query=${enc("how to repair " + q)}` },
      ] };
    },
  },
  {
    name: "search_reference_images",
    description: "Returns visual reference search links for components, parts and tutorials.",
    inputSchema: S({ query: str("What to look up, e.g. 'mixer grinder coupler'") }, ["query"]),
    run: ({ query }) => ({ images: [
      { source: "Wikimedia Commons", url: `https://commons.wikimedia.org/w/index.php?search=${enc(query)}&ns6=1` },
      { source: "Google Images", url: `https://www.google.com/search?tbm=isch&q=${enc(query + " repair diagram")}` },
    ] }),
  },
  {
    name: "generate_appliance_repair_plan",
    description: "Troubleshooting steps, feasibility level and tools for a faulty appliance.",
    inputSchema: S({ item: str("Appliance"), symptoms: str("Problem description") }, ["item", "symptoms"]),
    run: async ({ item, symptoms }) => {
      const s = symptoms.toLowerCase();
      let steps = ["Unplug the appliance and let it cool for 10 minutes.", "Inspect the power cord, plug and wall socket for damage or loose contact.", "Try a different socket and check your home's fuse or MCB."];
      let feasibility = "Moderate", tools_needed = ["Screwdriver set", "Multimeter (optional)"], safety = "Always unplug before opening. Do not open capacitors, microwave transformers or gas parts - take those to a professional.";
      if (has(s, "no power", "dead", "not turning on", "won't start", "not starting")) steps.push("Test the cord and fuse with a multimeter for continuity.", "Check the on/off switch and thermal cutoff for continuity.", "Replace whichever part fails the continuity test.");
      if (has(s, "noise", "loud", "vibrat", "rattl")) { steps.push("Open the housing and look for debris, loose screws or a worn coupler/belt.", "Lubricate bearings with a drop of machine oil; replace worn coupler or belt."); feasibility = "Easy to Moderate"; }
      if (has(s, "leak", "water")) { steps.push("Inspect hoses, gaskets and seals for cracks.", "Replace the cracked gasket or hose and re-test with a small load."); feasibility = "Easy to Moderate"; }
      if (has(s, "heat", "hot", "not heating", "burn", "smell")) { steps.push("Check the heating element for continuity (a broken coil reads open).", "Clean dust from vents; replace the thermostat if it never cuts off."); feasibility = "Moderate to Hard"; tools_needed.push("Replacement element/thermostat"); }
      steps.push("Reassemble, test with no load, then a normal load.", "If the fault remains, contact a professional repair service.");
      const ai = await gemini(`In 2 sentences, give the single most likely cause of a ${item} with this problem: ${symptoms}.`);
      return { item, likely_cause: ai || "See steps below, starting with power supply checks.", feasibility, tools_needed, steps, safety };
    },
  },
  {
    name: "generate_clothing_repair_ideas",
    description: "Practical fixes for tears, holes, zippers and buttons.",
    inputSchema: S({ garment: str("Garment type"), damage: str("tear, hole, zipper, button, seam, hem, stain, etc.") }, ["garment", "damage"]),
    run: ({ garment, damage }) => {
      const d = damage.toLowerCase(); const fixes = [];
      if (has(d, "zip")) fixes.push({ fix: "Realign or replace zipper slider", how: "Pry the slider's top plates slightly with pliers, or replace the slider using a matching zipper size.", difficulty: "Easy" });
      if (has(d, "button")) fixes.push({ fix: "Sew button back", how: "Use a matching thread, a toothpick between button and fabric for a thread shank, 6-8 passes, then wrap and knot.", difficulty: "Easy" });
      if (has(d, "hole", "tear", "rip")) fixes.push({ fix: "Patch or darn", how: "Iron-on patch on the inside plus a small zig-zag or visible sashiko stitching around the edge.", difficulty: "Easy to Moderate" }, { fix: "Visible mending", how: "Embroider over the hole with contrasting thread to turn the damage into a design.", difficulty: "Moderate" });
      if (has(d, "seam", "split")) fixes.push({ fix: "Restitch seam", how: "Use a backstitch along the original seam line, overlapping 2 cm past each end.", difficulty: "Easy" });
      if (has(d, "hem")) fixes.push({ fix: "Rehem", how: "Fold twice, press, and blind-stitch or use hem tape.", difficulty: "Easy" });
      if (has(d, "stain")) fixes.push({ fix: "Stain treatment", how: "Cold water rinse, dab with a mild detergent or baking soda paste, then wash. Avoid heat until the stain is gone.", difficulty: "Easy" });
      if (!fixes.length) fixes.push({ fix: "General patch/stitch", how: "Reinforce the weak area with a patch or running stitch matched to the fabric.", difficulty: "Easy" });
      return { garment, damage, fixes, materials: ["Needle and matching thread", "Fabric scraps or iron-on patch", "Scissors", "Iron"] };
    },
  },
  {
    name: "generate_upcycling_ideas",
    description: "Turns unused garments into new products with multi-step guides.",
    inputSchema: S({ garment: str("Garment to upcycle"), skill_level: str("beginner, intermediate or advanced (optional)") }, ["garment"]),
    run: async ({ garment, skill_level = "beginner" }) => {
      const g = garment.toLowerCase();
      let ideas;
      if (has(g, "jean", "denim")) ideas = ["Tote bag from the legs", "Denim coasters", "Pocket wall organiser", "Patchwork cushion cover"];
      else if (has(g, "shirt", "tee", "t-shirt", "cotton")) ideas = ["Reusable shopping bag (no-sew)", "Braided rag rug", "Cushion cover", "Hair scrunchies and headbands"];
      else if (has(g, "saree", "sari", "dupatta", "silk")) ideas = ["Quilted throw", "Table runner", "Dress or kurta panel", "Fabric gift wraps"];
      else if (has(g, "sweater", "wool")) ideas = ["Felted mittens", "Pet bed", "Cosy mug sleeves", "Pillow cover"];
      else ideas = ["Tote bag", "Cleaning rags", "Patchwork pouch", "Cushion cover"];
      const note = await gemini(`One sentence of encouragement for a ${skill_level} upcycling an old ${garment}.`);
      return { garment, skill_level, ideas: ideas.map((i) => ({ title: i, preview_search: `https://www.google.com/search?tbm=isch&q=${enc(i + " from old " + garment)}` })), tip: note || "Wash and press the garment first - clean fabric is much easier to cut and sew." };
    },
  },
  {
    name: "generate_step_by_step_guide",
    description: "Customised construction/repair instructions with variable-length steps.",
    inputSchema: S({ project: str("Project title, e.g. 'tote bag from old jeans'"), steps: { type: "number", description: "Approximate number of steps (3-12)" }, materials: str("Materials on hand (optional)") }, ["project"]),
    run: async ({ project, steps = 6, materials = "" }) => {
      const n = Math.max(3, Math.min(12, Number(steps) || 6));
      const ai = await gemini(`Write exactly ${n} concise numbered steps to complete this project: ${project}. Materials available: ${materials || "basic sewing/repair kit"}. One step per line.`);
      if (ai) return { project, source: "gemini", steps: ai.split("\n").map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean).slice(0, n) };
      const generic = ["Gather and prepare all materials and tools.", "Clean and inspect the item; mark where you will cut, stitch or open it.", "Make the main cuts or disassembly carefully.", "Do the core work (stitch, patch, replace or assemble).", "Reinforce stress points.", "Finish edges and tidy loose threads or wires.", "Test or try it out and adjust.", "Final clean-up and enjoy your remade item."];
      return { project, source: "built-in", steps: generic.slice(0, n) };
    },
  },
  {
    name: "estimate_repair_or_project_cost",
    description: "Estimates material and replacement part cost ranges.",
    inputSchema: S({ item: str("Item or project"), category: str("appliance or clothing"), issue: str("Problem or project type") }, ["item"]),
    run: ({ item, category, issue = "" }) => {
      const cat = detectCategory(item, category); const s = (issue + " " + item).toLowerCase();
      let inr = cat === "clothing" ? [0, 300] : [150, 1500];
      if (cat === "appliance") { if (has(s, "switch", "cord", "plug", "fuse")) inr = [50, 400]; else if (has(s, "motor", "compressor", "pcb", "board")) inr = [1200, 6000]; else if (has(s, "element", "thermostat", "gasket", "belt")) inr = [200, 1200]; }
      else if (has(s, "zip")) inr = [30, 250]; else if (has(s, "upcycl", "bag")) inr = [50, 500];
      return { item, currency: "INR", diy_parts_cost: { min: inr[0], max: inr[1] }, professional_cost: { min: Math.round(inr[1] * 0.8), max: Math.round(inr[1] * 2.5) }, note: "Rough estimates - local prices vary. Compare with a replacement price before repairing." };
    },
  },
  {
    name: "find_professional_repair_options",
    description: "Finds repair technicians and service centres near a location.",
    inputSchema: S({ item: str("Item to repair"), location: str("City or area") }, ["item", "location"]),
    run: ({ item, location }) => {
      const cat = detectCategory(item); const kind = cat === "clothing" ? "tailor alteration repair" : "repair service center";
      return { options: [
        { name: "Google Maps search", url: `https://www.google.com/maps/search/${enc(item + " " + kind + " near " + location)}` },
        { name: "Manufacturer service locator", url: `https://www.google.com/search?q=${enc(item + " authorized service center " + location)}` },
        { name: "Urban Company", url: `https://www.urbancompany.com/` },
        { name: "Justdial listings", url: `https://www.justdial.com/${enc(location)}/${enc(item + "-repair")}` },
      ], note: "Check reviews and ask for a written quote before handing over the item." };
    },
  },
];

// ---------- MCP JSON-RPC core ----------
const PROTOCOL = "2025-03-26";
async function handleRpc(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined) return null; // notification
  switch (method) {
    case "initialize":
      return ok({ protocolVersion: params?.protocolVersion || PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "remake-ai", version: "1.0.0" }, instructions: "RE:MAKE AI helps people repair, rework and reuse appliances and clothing." });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
      const args = params.arguments || {};
      const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === "");
      if (missing.length) return ok({ ...text({ error: `Missing required: ${missing.join(", ")}` }), isError: true });
      try { return ok(text(await tool.run(args))); }
      catch (e) { return ok({ ...text({ error: String(e.message || e) }), isError: true }); }
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return err(-32601, `Method not found: ${method}`);
  }
}

// ---------- stdio transport ----------
if (process.argv.includes("--stdio")) {
  let buf = "";
  process.stdin.on("data", async (d) => {
    buf += d; let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { const r = await handleRpc(JSON.parse(line)); if (r) process.stdout.write(JSON.stringify(r) + "\n"); }
      catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); }
    }
  });
} else {
  // ---------- HTTP transport + static site ----------
  const indexPath = path.join(__dirname, "public", "index.html");
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Expose-Headers": "Mcp-Session-Id" };
  const publicDir = path.join(__dirname, "public");
  const sseSessions = new Map();
  http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.method === "GET" && (url === "/health" || url === "/healthz")) { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", tools: tools.length })); }
    if (url === "/mcp" || url === "/mcp/") {
      if (req.method === "GET") { res.writeHead(405, { ...cors, Allow: "POST" }); return res.end(); }
      if (req.method === "DELETE") { res.writeHead(200, cors); return res.end(); }
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body);
          const batch = Array.isArray(parsed);
          const out = (await Promise.all((batch ? parsed : [parsed]).map(handleRpc))).filter(Boolean);
          if (!out.length) { res.writeHead(202, cors); return res.end(); }
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          res.end(JSON.stringify(batch ? out : out[0]));
        } catch {
          res.writeHead(400, { ...cors, "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
        }
      });
      return;
    }
    // ---- Legacy HTTP+SSE transport (used by NitroStudio / older MCP clients) ----
    const fullUrl = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url === "/sse") {
      const sid = require("crypto").randomUUID();
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      sseSessions.set(sid, res);
      res.write(`event: endpoint\ndata: /messages?sessionId=${sid}\n\n`);
      const beat = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clearInterval(beat); sseSessions.delete(sid); });
      return;
    }
    if (req.method === "POST" && (url === "/messages" || url === "/sse")) {
      const stream = sseSessions.get(fullUrl.searchParams.get("sessionId"));
      if (!stream) { res.writeHead(404, cors); return res.end("Unknown session"); }
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body);
          for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
            const r = await handleRpc(m);
            if (r) stream.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
          }
          res.writeHead(202, cors); res.end("Accepted");
        } catch { res.writeHead(400, cors); res.end("Bad request"); }
      });
      return;
    }
    if (req.method === "GET") {
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
      const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
      const file = path.join(publicDir, rel);
      if (file.startsWith(publicDir + path.sep)) {
        return fs.readFile(file, (e, data) => {
          if (e) { res.writeHead(404, cors); return res.end("Not found"); }
          res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
          res.end(data);
        });
      }
    }
    res.writeHead(404, cors); res.end("Not found");
  }).listen(PORT, "0.0.0.0", () => console.log(`RE:MAKE AI MCP server on :${PORT}  (site: /  MCP: /mcp  health: /health)`));
}
