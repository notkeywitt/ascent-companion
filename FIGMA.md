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

| Layer | What it gives you | Where it lives |
|-------|-------------------|----------------|
| **1. Figma Variables** | Everything you design is pre-constrained to the brand + both themes. | `figma/tokens.md` (the spec you build the Figma library from) |
| **2. Dev Mode MCP** | Point Claude Code at a frame → it builds the screen using the real primitives + tokens. | `.mcp.json` snippet below (runs on your *local* machine) |
| **3. Code Connect** | Figma Dev Mode shows the real `<Button variant="primary">` snippet; keeps design & code vocabularies identical. | `figma.config.json` + `src/components/ui.figma.tsx` |

---

## Layer 1 — Figma Variables (the foundation)

1. In Figma, create a **new team library file** ("Ascent Assistant").
2. Build the Variable collections exactly as specified in **[`figma/tokens.md`](figma/tokens.md)**:
   `Theme` (Light/Dark modes), `Brand`, `Radius`, banner tones, typography.
3. Bind your component fills / strokes / text to the **`Theme`** role variables
   (`accent`, `brand`, `text/interactive`, `bg/page`, `text/body`) — *not* raw
   hex. Then flipping the page mode Light↔Dark mirrors the app's `.dark` exactly.
4. **Publish** the library so other Figma files (your screens) can use it.

The payoff: you now get direct control by moving a *token*, and it maps 1:1 to a
variable in `globals.css`. You physically cannot design an off-brand accent.

> Keep the ochre-is-not-text rule (see `figma/tokens.md`): in **light** mode
> ochre is fills/borders/tints only; interactive text is black. Olive carries
> text in dark. This is baked into the `Theme` variables.

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
         "type": "sse",
         "url": "http://127.0.0.1:3845/mcp"
       }
     }
   }
   ```

   (Not committed by default — the endpoint is localhost, so it only works on the
   machine running Figma desktop. Add it locally when you want the bridge.)

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

**One-time install** (kept out of `package.json` until you run it, so the app
build stays clean in the meantime):

```bash
npm i -D @figma/code-connect
```

Already scaffolded in this repo:

- `figma.config.json` — points the CLI at `src/components/**/*.figma.tsx`.
- `src/components/ui.figma.tsx` — `figma.connect()` for every primitive, with the
  expected Figma property shapes. Excluded from `tsc`/`next build` via
  `tsconfig.json` (`"src/**/*.figma.tsx"`), so the un-filled scaffold can't break
  the app.

**To wire it up:**

1. Build the Figma component library (Layer 1) so the components exist.
2. In `src/components/ui.figma.tsx`, set `LIB` to your file URL and replace each
   `node-id=TODO` with the component's real node URL (Dev Mode → right-click →
   *Copy link to selection*). Rename the `figma.enum`/`figma.boolean`/`figma.string`
   property names to match your actual Figma component properties.
3. Authenticate and publish:

   ```bash
   npx figma connect publish   # add --dry-run first to validate
   ```

Now inspecting a button in Figma Dev Mode shows `<Button variant="primary">`.

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
