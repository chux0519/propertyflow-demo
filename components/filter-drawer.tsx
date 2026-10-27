"use client";

import { useState, type ReactNode } from "react";

/** On small screens the filters collapse behind a button; on large screens they are always shown. */
export function FilterDrawer({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="search-filters"
        className="mb-4 w-full rounded-md border border-sand-300 bg-white px-4 py-2 text-sm font-medium lg:hidden"
      >
        {label}
      </button>
      <div id="search-filters" className={`${open ? "block" : "hidden"} lg:block`}>
        {children}
      </div>
    </div>
  );
}
