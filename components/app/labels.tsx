"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { UiLabels } from "@/lib/labels";

const LabelsContext = createContext<UiLabels>({});

/** Makes the renamed labels from Settings → Labels available to the shell and pages. */
export function LabelsProvider({ labels, children }: { labels: UiLabels; children: ReactNode }) {
  return <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>;
}

/** Returns a function that gives the renamed text, or the text itself when it was not renamed. */
export function useLabel() {
  const labels = useContext(LabelsContext);
  return useCallback((text: string) => (Object.hasOwn(labels, text) ? labels[text] : text), [labels]);
}

/** The renamed text, for use in server components. */
export function UiText({ text }: { text: string }) {
  return useLabel()(text);
}
