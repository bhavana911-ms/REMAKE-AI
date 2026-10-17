# RE:MAKE AI - MCP Server
Repair It. Rework It. Reuse It.

- Start: `npm start` (listens on $PORT, default 3000)
- Website files (public/): index.html (HTML), styles.css (CSS), tailwind-config.js + app.js (JavaScript/React JSX). Served at `/`   MCP endpoint (Streamable HTTP): `POST /mcp`   Health: `/health`
- stdio mode: `node server.js --stdio`
- Optional env: `GEMINI_API_KEY` (adds live AI answers; works without it)
- Tools: describe_item_and_problem, get_follow_up_questions, search_repair_references, search_reference_images, generate_appliance_repair_plan, generate_clothing_repair_ideas, generate_upcycling_ideas, generate_step_by_step_guide, estimate_repair_or_project_cost, find_professional_repair_options
