// The names in the navigation and the page titles and descriptions that can be
// renamed under Settings → Labels. Saved changes are kept as
// { "<text written in the app>": "<new text>" } in system_appearance_settings
// .ui_labels; text that is not in the object stays as written. Shared by the
// server and the client, so it must stay free of server-only imports.
//
// A rename applies wherever the same text is shown through the label lookup:
// renaming "Cell Groups" changes the menu item, the breadcrumb and the page title.

import { NAV, PAGE_TITLES } from "@/lib/nav";

export type UiLabels = Record<string, string>;

export const LABEL_MAX_LENGTH = { name: 60, description: 300 } as const;

export type LabelEntry = {
  /** The text as written in the app; also the key it is saved under. */
  text: string;
  /** Where it appears, to tell entries apart. */
  hint?: string;
  kind: keyof typeof LABEL_MAX_LENGTH;
};

export type LabelGroup = { title: string; description: string; entries: LabelEntry[] };

/** Page descriptions shown under the title, with the page they belong to. */
const PAGE_DESCRIPTIONS: [page: string, description: string][] = [
  ["Settings", "Configure the system without touching code."],
  ["Reports", "Each report shows only what you are allowed to see in its module."],
  ["Ministries", "The teams members serve in."],
  ["Follow-ups", "Calls, visits and messages that someone has promised to make."],
  ["Finance settings", "How money is received and paid, and the accounts it sits in."],
  ["Attendance Records", "Every recorded mark, newest first."],
  ["Activity Logs", "Who changed what, and when. Entries are written by the database and cannot be edited."],
  ["Visitors", "People who have visited and are being followed up."],
  ["Services", "Each service, meeting or event that attendance is recorded for."],
  ["Pastoral Care", "Sensitive records. You only see the ones shared with you."],
  ["Giving", "Tithes, offerings and other giving received."],
  ["Finance", "Giving, expenses and the balance between them."],
  ["Expenses", "Money the church has spent."],
  ["Events", "Services, meetings and church activities."],
  ["Discipleship", "Where each member is on the growth path, and who is walking with them."],
  ["Attendance History", "Choose a person to see their attendance record and statistics."],
];

/** Page titles that are not a menu item or a breadcrumb. */
const OTHER_PAGE_TITLES = ["Add member", "Register visitor", "Giving collections", "New giving collection", "Finance settings"];

function unique(texts: string[], seen: Set<string>) {
  return texts.filter((text) => !seen.has(text) && Boolean(seen.add(text)));
}

function buildGroups(): LabelGroup[] {
  const seen = new Set<string>();
  const sections = unique([...NAV.flatMap((section) => (section.label ? [section.label] : [])), "All modules"], seen);
  const names = unique(
    [...NAV.flatMap((section) => section.items.map((item) => item.title)), ...Object.values(PAGE_TITLES), ...OTHER_PAGE_TITLES],
    seen,
  );
  const tabs = unique(["Home", "More"], seen);
  const descriptions = unique(PAGE_DESCRIPTIONS.map(([, description]) => description), seen);
  const pageOf = new Map(PAGE_DESCRIPTIONS.map(([page, description]) => [description, page]));

  return [
    {
      title: "Menu sections",
      description: "The headings that group the menu, and the title of the phone's “More” sheet.",
      entries: sections.map((text) => ({ text, kind: "name" })),
    },
    {
      title: "Modules and pages",
      description: "Menu items, breadcrumbs and page titles. A rename shows everywhere the name appears.",
      entries: names.map((text) => ({ text, kind: "name" })),
    },
    {
      title: "Phone tab bar",
      description: "The tabs at the bottom of the screen on phones.",
      entries: tabs.map((text) => ({ text, kind: "name" })),
    },
    {
      title: "Page descriptions",
      description: "The line under a page's title.",
      entries: descriptions.map((text) => ({ text, kind: "description", hint: pageOf.get(text) })),
    },
  ];
}

export const LABEL_GROUPS = buildGroups();

const ENTRIES = new Map(LABEL_GROUPS.flatMap((group) => group.entries.map((entry) => [entry.text, entry] as const)));

/**
 * Keeps only renames of known text, trimmed and within length; an empty value
 * or one equal to the original is dropped (it means "use the original").
 */
export function cleanLabels(input: Record<string, unknown>): UiLabels | null {
  const clean: UiLabels = {};
  for (const [text, value] of Object.entries(input)) {
    const entry = ENTRIES.get(text);
    if (!entry || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length > LABEL_MAX_LENGTH[entry.kind]) return null;
    if (trimmed && trimmed !== text) clean[text] = trimmed;
  }
  return clean;
}
