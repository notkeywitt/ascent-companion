/**
 * Code Connect mappings — Ascent Assistant design system.
 *
 * These bind the Figma components in the Ascent library to the REAL primitives
 * in `ui.tsx`, so Figma Dev Mode shows `<Button variant="primary">` (not a wall
 * of generated CSS) and Claude/devs build from the exact same vocabulary.
 *
 * This file is a SCAFFOLD. Two things must happen before `figma connect publish`
 * works — both are one-time and both are described in `../../FIGMA.md`:
 *   1. Install the CLI once:  npm i -D @figma/code-connect
 *   2. Replace every `node-id=TODO` below with the real node URL of the matching
 *      component in your Figma library (Dev Mode → right-click → Copy link).
 * The Figma property NAMES/VALUES in each `figma.enum(...)` are the expected
 * shape — rename them to match your actual Figma component properties.
 *
 * Excluded from `tsc`/`next build` via tsconfig ("src/**\/*.figma.tsx"), so an
 * un-filled scaffold never breaks the app build; only the `figma` CLI reads it.
 */

import figma from "@figma/code-connect";
import {
  Button,
  Toggle,
  Input,
  Select,
  Textarea,
  Card,
  Banner,
  EmptyState,
  PageHeader,
} from "@/components/ui";

// Root of the Ascent component library in Figma. Fill in the file key, then the
// per-component node ids below (everything after node-id=).
const LIB = "https://www.figma.com/design/FILE_KEY/Ascent-Assistant";

/* -------------------------------------------------------------------- Button */
figma.connect(Button, `${LIB}?node-id=TODO`, {
  props: {
    variant: figma.enum("Variant", {
      Primary: "primary",
      Secondary: "secondary",
      Outline: "outline",
      Ghost: "ghost",
      Danger: "danger",
    }),
    size: figma.enum("Size", { Small: "sm", Medium: "md", Large: "lg" }),
    disabled: figma.boolean("Disabled"),
    label: figma.string("Label"),
  },
  example: ({ variant, size, disabled, label }) => (
    <Button variant={variant} size={size} disabled={disabled}>
      {label}
    </Button>
  ),
});

/* -------------------------------------------------------------------- Toggle */
figma.connect(Toggle, `${LIB}?node-id=TODO`, {
  props: {
    checked: figma.boolean("On"),
    label: figma.string("Label"),
  },
  example: ({ checked, label }) => (
    <Toggle checked={checked} onChange={() => {}} label={label} />
  ),
});

/* --------------------------------------------------------------------- Input */
figma.connect(Input, `${LIB}?node-id=TODO`, {
  props: {
    placeholder: figma.string("Placeholder"),
    disabled: figma.boolean("Disabled"),
  },
  example: ({ placeholder, disabled }) => (
    <Input placeholder={placeholder} disabled={disabled} />
  ),
});

/* -------------------------------------------------------------------- Select */
figma.connect(Select, `${LIB}?node-id=TODO`, {
  props: { disabled: figma.boolean("Disabled") },
  example: ({ disabled }) => <Select disabled={disabled} />,
});

/* ------------------------------------------------------------------ Textarea */
figma.connect(Textarea, `${LIB}?node-id=TODO`, {
  props: {
    placeholder: figma.string("Placeholder"),
    disabled: figma.boolean("Disabled"),
  },
  example: ({ placeholder, disabled }) => (
    <Textarea placeholder={placeholder} disabled={disabled} />
  ),
});

/* ---------------------------------------------------------------------- Card */
figma.connect(Card, `${LIB}?node-id=TODO`, {
  props: {
    pad: figma.boolean("Padded"),
    children: figma.children("*"),
  },
  example: ({ pad, children }) => <Card pad={pad}>{children}</Card>,
});

/* -------------------------------------------------------------------- Banner */
figma.connect(Banner, `${LIB}?node-id=TODO`, {
  props: {
    tone: figma.enum("Tone", {
      Error: "error",
      Warning: "warning",
      Success: "success",
      Info: "info",
      Neutral: "neutral",
    }),
    children: figma.string("Message"),
  },
  example: ({ tone, children }) => <Banner tone={tone}>{children}</Banner>,
});

/* ---------------------------------------------------------------- EmptyState */
figma.connect(EmptyState, `${LIB}?node-id=TODO`, {
  props: { children: figma.string("Message") },
  example: ({ children }) => <EmptyState>{children}</EmptyState>,
});

/* ---------------------------------------------------------------- PageHeader */
figma.connect(PageHeader, `${LIB}?node-id=TODO`, {
  props: {
    title: figma.string("Title"),
    description: figma.string("Description"),
  },
  example: ({ title, description }) => (
    <PageHeader title={title} description={description} />
  ),
});
