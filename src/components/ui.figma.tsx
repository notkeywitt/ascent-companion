/**
 * Code Connect mappings — Ascent Assistant design system.
 *
 * These bind the Figma components in the Ascent library to the REAL primitives
 * in `ui.tsx`, so Figma Dev Mode shows `<Button variant="primary">` (not a wall
 * of generated CSS) and Claude/devs build from the exact same vocabulary.
 *
 * Wired to the live library — file key `DMJeL5CTgIt4OusKOqoqfU`, node ids below
 * are the real component sets. To publish:
 *
 *     npx figma connect publish --dry-run   # validate
 *     npx figma connect publish
 *
 * Excluded from `tsc`/`next build` via tsconfig ("src/**\/*.figma.tsx"), so this
 * file never breaks the app build; only the `figma` CLI reads it.
 *
 * Figma property names are authoritative — they were created to match these
 * mappings. If you rename a property in Figma, rename it here in the same pass.
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
  Label,
  SectionLabel,
} from "@/components/ui";

/* -------------------------------------------------------------------- Button
 * Figma: Variant × Size × State (30 variants). Hover is not a variant — it is a
 * CSS transition in ui.tsx, documented as swatches on the Figma Button page. */
figma.connect(Button, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=15-2", {
  props: {
    variant: figma.enum("Variant", {
      Primary: "primary",
      Secondary: "secondary",
      Outline: "outline",
      Ghost: "ghost",
      Danger: "danger",
    }),
    size: figma.enum("Size", { Small: "sm", Medium: "md", Large: "lg" }),
    disabled: figma.enum("State", { Disabled: true, Default: false }),
    label: figma.string("Label"),
  },
  example: ({ variant, size, disabled, label }) => (
    <Button variant={variant} size={size} disabled={disabled}>
      {label}
    </Button>
  ),
});

/* -------------------------------------------------------------------- Toggle */
figma.connect(Toggle, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=19-22", {
  props: {
    checked: figma.enum("On", { True: true, False: false }),
    disabled: figma.enum("State", { Disabled: true, Default: false }),
    label: figma.string("Label"),
  },
  example: ({ checked, disabled, label }) => (
    <Toggle checked={checked} onChange={() => {}} label={label} disabled={disabled} />
  ),
});

/* ------------------------------------------------------ Input / Select / Textarea
 * One Figma component with a `Type` variant, because ui.tsx renders the same
 * `inputCls` box for all three. Each React component maps to one Type value. */
figma.connect(Input, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=18-30", {
  variant: { Type: "Text" },
  props: {
    placeholder: figma.string("Placeholder"),
    disabled: figma.enum("State", { Disabled: true, Default: false }),
  },
  example: ({ placeholder, disabled }) => (
    <Input placeholder={placeholder} disabled={disabled} />
  ),
});

figma.connect(Select, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=18-30", {
  variant: { Type: "Select" },
  props: {
    disabled: figma.enum("State", { Disabled: true, Default: false }),
  },
  example: ({ disabled }) => <Select disabled={disabled} />,
});

figma.connect(Textarea, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=18-30", {
  variant: { Type: "Textarea" },
  props: {
    placeholder: figma.string("Placeholder"),
    disabled: figma.enum("State", { Disabled: true, Default: false }),
  },
  example: ({ placeholder, disabled }) => (
    <Textarea placeholder={placeholder} disabled={disabled} />
  ),
});

/* -------------------------------------------------------- Label / SectionLabel
 * Same caption style; the Figma `Type` variant carries the semantic difference
 * (Field pairs with an input and adds mb-1, Section is a standalone heading). */
figma.connect(Label, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=20-10", {
  variant: { Type: "Field" },
  props: { children: figma.string("Text") },
  example: ({ children }) => <Label>{children}</Label>,
});

figma.connect(SectionLabel, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=20-10", {
  variant: { Type: "Section" },
  props: { children: figma.string("Text") },
  example: ({ children }) => <SectionLabel>{children}</SectionLabel>,
});

/* ---------------------------------------------------------------------- Card */
figma.connect(Card, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=21-14", {
  props: {
    pad: figma.enum("Padded", { True: true, False: false }),
    children: figma.children("*"),
  },
  example: ({ pad, children }) => <Card pad={pad}>{children}</Card>,
});

/* -------------------------------------------------------------------- Banner */
figma.connect(Banner, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=22-18", {
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
figma.connect(EmptyState, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=23-2", {
  props: { children: figma.string("Message") },
  example: ({ children }) => <EmptyState>{children}</EmptyState>,
});

/* ---------------------------------------------------------------- PageHeader */
figma.connect(PageHeader, "https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU/Ascent-Assistant?node-id=24-3", {
  props: {
    title: figma.string("Title"),
    description: figma.string("Description"),
    actions: figma.children("actions"),
  },
  example: ({ title, description, actions }) => (
    <PageHeader title={title} description={description} actions={actions} />
  ),
});
