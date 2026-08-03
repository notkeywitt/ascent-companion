# Figma in the Ascent Assistant workflow

Goal: **direct visual control of design** without throwing away the discipline
that keeps this app coherent. You design in Figma; the design flows into the
code through tokens and named components — not through generated CSS.

## Why this works here (and the trap it avoids)

The Assistant is already a **token-driven** app:

- **Tokens** live in `src/app/globals.css` (theme role variables — `--accent`,
  `--brand`, the dark surface scale) and `tailwind.config.ts` (brand hues + the
  role wiring). Change a token, and every `bg-accent` / `border-accent` /
  `text-accent` across the app flips with it.
- **Primitives** live in one file, `src/components/ui.tsx` — `Button`, `Toggle`,
  `Input`, `Select`, `Textarea`, `Card`, `Banner`, `EmptyState`, `PageHeader`,
  with locked variants, sizes, radii, and dark-mode surfaces.

> **The trap:** Figma's "export to code" / Figma Make emit standalone HTML or
> ad-hoc React. Pasted into this repo they ignore `ui.tsx` and the token
> variables, re-introducing the per-page drift `ui.tsx` exists to kill. Fast to
> demo, expensive to live with. **We don't use codegen as the source of truth.**
> Figma feeds *tokens* and *component intent*; the code stays the primitives.

## The three layers

| Layer | What it gives you | Where it lives | Status |
|-------|-------------------|----------------|--------|
| **1. Figma Variables** | Everything you design is pre-constrained to the brand + both themes. | `figma/tokens.md` | ✅ built |
| **2. Dev Mode MCP** | Point Claude Code at a frame → it builds the screen using the real primitives + tokens. | `.mcp.json` (local) or the hosted `mcp.figma.com` | ✅ both connected |
| **3. Code Connect** | Figma Dev Mode shows the real `<Button variant="primary">` snippet; keeps design & code vocabularies identical. | `figma.config.json` + `src/components/ui.figma.tsx` | 🚫 **blocked — needs an Org/Enterprise plan** |

**The library:** [figma.com/design/DMJeL5CTgIt4OusKOqoqfU](https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU)
— *Ascent Assistant*, in the **Ascent Assistant** project (it had to leave Drafts
to be publishable). 5 collections / 80 variables / 5 styles / 8 components /
54 variants, published as a team library. Start on its **Getting Started** page.

> **Layers 1 and 2 are the ones that matter, and both work.** Layer 3 is a
> convenience — it only changes what Dev Mode *displays*. The build loop does not
> depend on it: Claude reads frame structure and variables straight over MCP, and
> the design↔code mapping is already written down in `figma/components.md` and
> `src/components/ui.figma.tsx`. Nothing about the workflow is blocked.

---

## Layer 1 — Figma Variables (the foundation)

**Built.** Five collections, described in **[`figma/tokens.md`](figma/tokens.md)**:

- **`Theme`** (Light/Dark modes) — 24 semantic roles. This is the one you design
  against. Every role aliases into a primitive; none holds a raw hex.
- **`Brand`** (15) — the fixed Brand Guidelines hues + the dark surface scale.
- **`Palette`** (28) — Tailwind neutral/status scales for borders and banners.
- **`Radius`** (3) and **`Spacing`** (10) — the geometry the primitives use.

Bind component fills / strokes / text to the **`Theme`** roles, never raw hex.
Flipping a frame's Theme mode Light↔Dark then mirrors the app's `.dark` exactly.

The payoff: you get direct control by moving a *token*, and it maps 1:1 to a
variable in `globals.css`. You physically cannot design an off-brand accent.

> **The ochre-is-not-text rule is now enforced, not just documented.**
> `accent/DEFAULT`, `accent/hover` and `brand` carry no `TEXT_FILL` scope, so
> Figma won't offer ochre when you're colouring text. Use `text/interactive` —
> black in light, olive in dark.

**Still to do:** publish the library (Assets panel → Publish) so other Figma
files can use it.

---

## Layer 2 — Dev Mode MCP server (the build bridge)

Figma ships an official **Dev Mode MCP server**. Connected to Claude Code, it
lets you select a frame in Figma and have Claude implement it **using the
`ui.tsx` primitives and your tokens**.

**Setup (do this in Claude Code running on your Mac — see the caveat below):**

1. Figma desktop app → **Preferences → Enable Dev Mode MCP server**. It serves
   locally at `http://127.0.0.1:3845/mcp`.
2. Add it to Claude Code. Project-scoped `.mcp.json` in this repo root:

   ```jsonc
   {
     "mcpServers": {
       "figma": {
         "type": "http",
         "url": "http://127.0.0.1:3845/mcp"
       }
     }
   }
   ```

   (Not committed by default — the endpoint is localhost, so it only works on the
   machine running Figma desktop. Add it locally when you want the bridge.)

   > **Transport matters — pair the two correctly.** The server exposes *two*
   > endpoints with *different* protocols: `/mcp` speaks **Streamable HTTP**
   > (`"type": "http"`, above) and `/sse` speaks the older **SSE** transport
   > (`"type": "sse"`). Don't cross them: `"type": "sse"` pointed at `/mcp` fails to
   > connect (the SSE client GETs `/mcp` and gets an HTTP 400). Use `http`+`/mcp`
   > (preferred) or `sse`+`/sse`. After adding/editing `.mcp.json`, **restart Claude
   > Code** — MCP config is read once at startup — and approve the project-scoped
   > server when prompted.

   > **Read from the root, not `--add-dir`.** Claude Code loads a project
   > `.mcp.json` from the session's *root* directory only — not from directories
   > added with `--add-dir`. If you run Claude Code rooted in another repo (e.g. the
   > appscript suite) with this one merely added, the file above is silently ignored
   > and no figma tools appear. In that case register the bridge at **user scope** so
   > it loads regardless of which repo is the root:
   >
   > ```bash
   > claude mcp add --transport http --scope user figma http://127.0.0.1:3845/mcp
   > ```
   >
   > (`claude mcp remove figma` to undo; `claude mcp list` shows health.)

**The build loop:**

1. Design / adjust a screen in Figma; select the frame.
2. In Claude Code: *"Build the selected Figma frame as a new page, using the
   primitives in `src/components/ui.tsx` and our tokens."*
3. Claude reads the frame's structure + variables over MCP and writes the page
   composing `Button`/`Card`/`Banner`/… — reviewable diff, then you run it.

> ⚠️ **Remote (claude.ai/code on the web) can't reach it.** The Dev Mode MCP
> server is `localhost` on *your* machine; a cloud session runs in an isolated
> container with no route to it. Use this layer from **Claude Code on your Mac**.
> Figma frames, Variables, and Code Connect (below) all still work; only the live
> MCP read is local-only. Figma has been rolling out a hosted/remote MCP option —
> if you have it, swap the `url` for the remote endpoint and it works anywhere.

---

## Layer 3 — Code Connect (design/dev parity)

Maps the Figma library components to the real `ui.tsx` primitives so Dev Mode
shows the actual code snippet.

`@figma/code-connect` is installed (devDependency, v1.5.1). Both files are wired
to the live library and **`npx figma connect parse` succeeds** — 11 connections
across 8 components:

- `figma.config.json` — parser config.
- `src/components/ui.figma.tsx` — `figma.connect()` for every primitive, with
  real node ids. Excluded from `tsc`/`next build` via `tsconfig.json`
  (`"src/**/*.figma.tsx"`), so it can never break the app build.

> ## 🚫 Blocked on plan — don't burn time retrying this
>
> **Code Connect requires a Dev or Full seat on an Organization or Enterprise
> plan.** This account is on **Pro**, so publishing fails no matter how it's
> attempted. Verified two ways (31 Jul 2026):
>
> - `npx figma connect publish` → *"Couldn't find a Figma access token"*. The
>   token won't help: the **Code Connect scope simply isn't offered** in the
>   personal-access-token UI below Org/Enterprise. (This is the cause of the
>   recurring *"the Code Connect scope is missing"* Figma forum threads — it
>   reads like a UI bug and is actually the plan gate.)
> - Writing via the Figma MCP `add_code_connect_map`, which needs no token at
>   all → *"You need a Dev or Full seat on an Organization or Enterprise plan to
>   use Code Connect."*
>
> **Nothing here is misconfigured.** `npx figma connect parse` succeeds and
> `--dry-run` lists all 11 connections, so the moment the plan allows it:
>
> ```bash
> npx figma connect publish --dry-run   # validate
> npx figma connect publish             # needs Code Connect: Write + File content: Read
> ```
>
> **Keep `ui.figma.tsx` regardless.** Even unpublished it is the written record
> of which Figma property maps to which React prop — the thing Claude reads when
> building a frame, and the first place to look when design and code drift.
>
> ### Why losing this costs less than it sounds
>
> Every variable carries **WEB code syntax**, so the MCP already returns the
> codebase vocabulary rather than raw colour. Asking it for the Button's tokens
> returns exactly this:
>
> ```jsonc
> { "var(--accent)": "#cf9803",
>   "var(--accent-fg)": "#faf7ee",
>   "rounded-lg": "8",
>   "text-neutral-700 dark:text-neutral-300": "#404040",
>   "border-red-300 dark:border-red-900": "#fca5a5",
>   "Body/sm Strong": "Roboto SemiBold 14/20" }
> ```
>
> Token-level handoff — including the `dark:` pairs — therefore already works
> without Code Connect. What's actually missing is only the component-level
> snippet (`<Button variant="primary">`) rendered inside Dev Mode's inspect
> panel, and `ui.figma.tsx` records that mapping for anyone reading the repo.

> **Three config gotchas that cost real time — all fixed here, don't undo them.**
>
> 1. **The node URL must be a string literal.** Building it from a shared `LIB`
>    constant via a template literal fails with *"The second argument to
>    figma.connect() must be a string literal"*.
>    Template literals and interpolated constants are rejected by the parser, so
>    each URL is written out in full.
> 2. **`include` must match the component SOURCE file, not just the `.figma.tsx`.**
>    With `include: ["src/components/**/*.figma.tsx"]` the parser can't resolve
>    `Button` and dies with `Cannot read properties of undefined (reading 'split')`.
>    It's `["src/components/**/*.tsx"]`.
> 3. **`paths` takes tsconfig-style ARRAYS.** It is handed straight to the
>    TypeScript compiler, so `{"@/*": "src/*"}` silently fails to resolve the
>    alias — it must be `{"@/*": ["./src/*"]}`.

> **Deprecation, Aug 2026.** The Figma CLI warns that framework-specific parsers
> (what this file uses) stop receiving updates on **17 Aug 2026**, in favour of
> template files. Nothing to do now; revisit before then.
> See <https://developers.figma.com/docs/code-connect/templates-migration-guide/>.

---

## End-to-end, once set up

1. **Design** a screen in Figma against the published Variables + components.
2. **Build** it: select the frame, ask Claude Code (local) to implement it with
   `ui.tsx` + tokens. Code Connect gives it the exact component names.
3. **Verify**: `npm run dev`, flip the theme toggle — Light/Dark should match the
   two Figma modes because both read the same token contract.
4. **Token change?** Edit it in Figma *and* in `globals.css`/`tailwind.config.ts`
   in the same commit; update `figma/tokens.md`. The whole app re-tints.

## Guardrails (don't undo the system)

- Compose `ui.tsx` primitives; don't hand-roll buttons/inputs/cards per page.
- Don't paste raw generated CSS/HTML as the source of truth.
- Keep the light-mode ochre-not-text contrast rule.
- Cards sit **lighter** than the dark page (`bg-ink-raised`), never darker.
