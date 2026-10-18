# REMAKE-AI

> RE:MAKE AI is an intelligent circular economy platform that combats the mounting global crises of e-waste and fast-fashion waste by turning everyday consumers into confident DIY repairers.

![Model Context Protocol](https://img.shields.io/badge/Model%20Context%20Protocol-MCP-blue) ![Built with Nitrostack](https://img.shields.io/badge/Built%20with-Nitrostack-0A66FF) ![Status](https://img.shields.io/badge/status-live-brightgreen)

**REMAKE-AI** is an [MCP (Model Context Protocol)](https://nitrostack.ai) server that extends AI assistants, like Claude, Cursor, and any MCP-compatible client, with real-world repair and upcycling capabilities. It is built and deployed on [Nitrostack](https://nitrostack.ai), the fastest way to build, deploy, and share MCP apps. It also ships with a companion web app (React + Tailwind) that uses the same ideas through a friendly UI.

## Table of Contents

- [Overview](#overview)
- [What is MCP?](#what-is-mcp)
- [Features](#features)
- [MCP Tools](#mcp-tools)
- [Live Demo](#live-demo)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Connect to an MCP Client](#connect-to-an-mcp-client)
- [Deploy Your Own MCP App](#deploy-your-own-mcp-app)
- [Explore More MCP Apps](#explore-more-mcp-apps)
- [FAQ](#faq)
- [Keywords](#keywords)
- [License](#license)

## Overview

RE:MAKE AI is an intelligent circular economy platform that combats the mounting global crises of e-waste and fast-fashion waste by turning everyday consumers into confident DIY repairers. Powered by Gemini AI reasoning, links to manufacturer manuals and repair guides, and a Model Context Protocol (MCP) architecture, it delivers step-by-step troubleshooting for household appliances, clothing repairs, and creative garment upcycling. By bridging the gap between expert technical guidance and everyday accessibility, RE:MAKE AI empowers users to extend product lifecycles, save money, and drive real-world sustainability.

## What is MCP?

The **Model Context Protocol (MCP)** is an open standard that lets AI assistants securely connect to external tools, data sources, and services. Instead of being limited to what it was trained on, an AI model can call **MCP servers** to fetch live data, run actions, and integrate with real systems.

This project is one such MCP server. Learn more about building and shipping MCP apps at [nitrostack.ai](https://nitrostack.ai).

## Features

- 🔌 **MCP-native**: works with any MCP-compatible client (Claude, Cursor, and more)
- 🛠️ **10 repair and upcycling tools**: structured capabilities for appliances and clothing
- 🤖 **Optional Gemini power**: live AI answers when a `GEMINI_API_KEY` is set, built-in answers when it is not
- 📦 **Zero dependencies**: plain Node.js, so nothing can fail during `npm install`
- 🌐 **Companion web app**: guided appliance diagnostics, clothing repair guides, and upcycling projects
- ⚡ **Deployed on Nitrostack**: hosted and instantly shareable
- 🔐 **Secure by design**: secrets stay in environment variables, never in code

## MCP Tools

| Tool | What it does |
|---|---|
| `describe_item_and_problem` | Normalizes the item, category and symptoms (and optional image info) |
| `get_follow_up_questions` | Generates item-specific diagnostic follow-up questions |
| `search_repair_references` | Returns manual, troubleshooting and video-tutorial links for the item |
| `search_reference_images` | Returns visual reference links for components, parts and diagrams |
| `generate_appliance_repair_plan` | Troubleshooting steps, feasibility level, tools and safety notes |
| `generate_clothing_repair_ideas` | Practical fixes for tears, holes, zippers, buttons, seams and hems |
| `generate_upcycling_ideas` | Turns unused garments into new products |
| `generate_step_by_step_guide` | Custom construction or repair instructions with a chosen number of steps |
| `estimate_repair_or_project_cost` | Rough DIY and professional cost ranges (INR) |
| `find_professional_repair_options` | Links to repair technicians and service centres near a location |

## Live Demo

🚀 **Live app:** https://re-make-ai-6ad337ab-bhavana-ms-heapify-global-community.app.nitrocloud.ai

- Health check: `GET /health`
- MCP endpoint (Streamable HTTP): `POST /mcp`
- MCP endpoint (SSE, used by NitroStudio): `GET /sse`

Point your MCP client at the MCP endpoint to try it instantly. Prefer a hosted setup? Deploy your own in minutes on [Nitrostack](https://nitrostack.ai).

## Project Structure

```
remake-ai/
├── package.json            # npm scripts (start, build, test)
├── server.js               # MCP server (JSON-RPC over HTTP, or stdio) + static file hosting
├── test.js                 # Smoke tests for the server and all 10 tools
├── .env.example            # Optional environment variables
└── public/                 # Companion web app
    ├── index.html          # HTML page skeleton
    ├── styles.css          # CSS (font and base styles)
    ├── tailwind-config.js  # Tailwind theme (brand colours)
    └── app.js              # React (JSX) app logic and Gemini calls
```

## Getting Started

### Prerequisites

- Node.js 18+
- An MCP-compatible client (Claude Desktop, Cursor, etc.)

### Installation

```bash
git clone https://github.com/your-username/remake-ai.git
cd remake-ai
```

There are no packages to install. The server uses only built-in Node.js modules.

### Configuration

Copy the example environment file and add your own values (all optional):

```bash
cp .env.example .env
```

`GEMINI_API_KEY` is optional. Without it, every tool still works using built-in logic. With it, follow-up questions, repair-cause hints and step-by-step guides use live Gemini answers.

> The `.env` file is not loaded automatically. Set these variables in your shell or hosting dashboard, for example `GEMINI_API_KEY=your_key npm start`.

### Run

```bash
npm run start
```

Then open http://localhost:3000 for the web app. The web app asks visitors for their own Gemini API key in its Settings popup, and the key is stored only in their browser.

### Test

```bash
npm test
```

## Connect to an MCP Client

Add this server to your MCP client configuration. A typical entry looks like:

```json
{
  "mcpServers": {
    "remake-ai": {
      "url": "https://re-make-ai-6ad337ab-bhavana-ms-heapify-global-community.app.nitrocloud.ai/sse"
    }
  }
}
```

For a local setup over stdio, use:

```json
{
  "mcpServers": {
    "remake-ai": {
      "command": "node",
      "args": ["server.js", "--stdio"]
    }
  }
}
```

Restart your client and the tools from this MCP server will be available to your AI assistant.

## Deploy Your Own MCP App

Want to build and ship an MCP server like this one? **[Nitrostack](https://nitrostack.ai)** lets you create, deploy, and host MCP apps in minutes, with no infrastructure to manage.

Zip this project so that `package.json` is at the top level, upload it, and set `GEMINI_API_KEY` as an environment variable if you want live AI answers.

👉 **Start building:** [https://nitrostack.ai](https://nitrostack.ai)

## Explore More MCP Apps

- 🌙 Discover and share MCP projects with the community on [r/mcptothemoon](https://www.reddit.com/r/mcptothemoon/)
- 🧰 Browse a growing catalog of MCP apps on [Nitrostack](https://nitrostack.ai/apps)

## FAQ

### What is an MCP server?

An MCP server implements the Model Context Protocol to expose tools, resources, and prompts that AI assistants can call. It lets an AI model take real actions and access live data.

### What does REMAKE-AI do?

It helps people repair, rework and reuse what they own. Ask it to diagnose a faulty appliance, fix a torn or broken garment, estimate costs, find a local technician, or turn old clothes into something new.

### Do I need an API key?

No. The server and all 10 tools work without one. Adding a Gemini API key (`GEMINI_API_KEY`) switches some tools to live AI answers. The web app asks each visitor for their own key to power its AI features.

### Which AI clients does this work with?

Any MCP-compatible client, including Claude Desktop and Cursor. New clients are adding MCP support regularly.

### How do I deploy my own MCP app?

Use [Nitrostack](https://nitrostack.ai) to build, deploy, and host MCP apps without managing infrastructure.

## Keywords

`REMAKE-AI` · `MCP` · `Model Context Protocol` · `MCP server` · `MCP app` · `AI tools` · `AI agents` · `LLM tools` · `Claude MCP` · `Nitrostack` · `deploy MCP server` · `build MCP app` · `circular economy` · `e-waste` · `upcycling` · `repair`

## License

MIT © 2026

---

Built with ❤️ using the Model Context Protocol on [Nitrostack](https://nitrostack.ai). Share your MCP app on [r/mcptothemoon](https://www.reddit.com/r/mcptothemoon/).
