"use client";

import { useState } from "react";
import { SectionHeading } from "@/components/ui";

/**
 * A dashboard section that folds away on phones. From the `lg` width up the
 * columns sit side by side, so the section is always open and the heading is plain.
 */
export function MobileSection({
  title,
  trailing,
  className = "mb-6",
  children,
}: {
  title: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="lg:hidden">
        <SectionHeading trailing={trailing} open={open} onToggle={() => setOpen((o) => !o)}>
          {title}
        </SectionHeading>
      </div>
      <div className="hidden lg:block">
        <SectionHeading trailing={trailing}>{title}</SectionHeading>
      </div>
      <div className={open ? "" : "hidden lg:block"}>{children}</div>
    </section>
  );
}
