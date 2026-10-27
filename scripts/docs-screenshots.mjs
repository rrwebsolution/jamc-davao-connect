// Captures the screenshots used by docs/JAMC-Davao-Connect-User-Manual.md from
// the real, running application.
//
//   npm run build && npx next start -p 3100        (in one terminal)
//   npm run docs:screenshots -- --base http://localhost:3100 --temp-admin
//
// Signing in:
//   --temp-admin: a temporary Super Admin is created with the secret key, used
//   for the screenshots, and deleted again at the end.
//   Or put DOCS_EMAIL and DOCS_PASSWORD (a Super Admin account meant for
//   documentation) in .env.local. They are read here and never written out.
//
// Other options:
//   --public-only        only the sign-in pages (no account needed)
//   --only <folder>      only one folder, e.g. --only finance
//   --files <a,b>        only these pictures, e.g. --files finance/giving,mobile/more-menu
//   --debug-path <path> --debug-expr <js>   print what one signed-in page looks like
//
// What it does to keep the pictures safe to share:
//   - Opens demo records (is_demo) for profile and detail pages.
//   - Replaces every email address and mobile number on screen with a
//     placeholder before each picture. Nothing in the database changes.
//   - Opens pastoral care only as an empty "New care record" form.
//
// Each picture is taken in a fresh Edge on a shared, signed-in profile: a
// single long-running headless tab becomes unreliable after a few dozen pages.
//
// Needs Microsoft Edge (or set EDGE_PATH). No extra npm packages.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// --- settings -------------------------------------------------------------------

for (const line of existsSync(".env.local") ? readFileSync(".env.local", "utf8").split(/\r?\n/) : []) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = option("--base", "http://localhost:3100").replace(/\/$/, "");
const ONLY = option("--only", null);
const FILES = option("--files", null)?.split(",").map((name) => name.trim().replace(/\.png$/, ""));
const OUT = "docs/screenshots";
const DESKTOP = { width: 1440, height: 900, mobile: false, deviceScaleFactor: 1 };
const PHONE = { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 };
const EDGE =
  process.env.EDGE_PATH ??
  ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!EDGE) throw new Error("Microsoft Edge was not found. Set EDGE_PATH.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- a small Chrome DevTools Protocol client ----------------------------------------

/** Starts Edge on a profile folder (not deleted here) and connects to its page. */
async function openBrowser(profile) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], {
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let target;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) {
    child.kill();
    throw new Error("Could not start Edge.");
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const me = (id += 1);
      pending.set(me, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      ws.send(JSON.stringify({ id: me, method, params }));
    });
  // Browser.close lets Edge write its cookies to the profile, so the sign-in carries over.
  const close = async () => {
    try {
      ws.send(JSON.stringify({ id: (id += 1), method: "Browser.close" }));
    } catch {}
    await Promise.race([exited, sleep(5000)]);
    child.kill();
    try {
      ws.close();
    } catch {}
  };
  return { send, close };
}

/** One page in a fresh Edge on the given profile, with the helpers the shots need. */
async function openPage(profile) {
  const browser = await openBrowser(profile);
  const { send } = browser;
  await send("Page.enable");
  await send("Runtime.enable");
  // Light theme, no animations: clean, repeatable pictures.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.setItem('theme', 'light') } catch {}" });
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-color-scheme", value: "light" },
    ],
  });

  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails && process.env.DOCS_DEBUG) {
      console.log("  page error:", response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result?.value;
  };
  const size = (viewport) => send("Emulation.setDeviceMetricsOverride", viewport);
  const go = async (path) => {
    await send("Page.navigate", { url: BASE + path });
    for (let i = 0; i < 120; i += 1) {
      await sleep(250);
      const ready = await evaluate(
        `location.href !== "about:blank" && document.readyState === "complete" && !document.querySelector("[aria-busy=true]")`,
      ).catch(() => false);
      if (ready) break;
    }
    await sleep(900);
  };
  // Elements can appear a moment after the page: keep looking for a few seconds.
  const findAnd = async (query, action) => {
    for (let i = 0; i < 24; i += 1) {
      const ok = await evaluate(`(() => { const el = (${FIND})(${JSON.stringify(query)}); if (!el) return false; ${action}; return true; })()`);
      if (ok) return true;
      await sleep(250);
    }
    return false;
  };
  return { send, evaluate, size, go, findAnd, close: browser.close };
}

// --- the account used for the pictures ---------------------------------------------------

const admin =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

async function temporaryAdmin() {
  if (!admin) throw new Error("--temp-admin needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");
  const email = `docs-screenshots-${Date.now()}@example.invalid`;
  const password = `Docs-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Documentation" } });
  if (error) throw error;
  const userId = data.user.id;
  const { data: role } = await admin.from("roles").select("id").eq("key", "super_admin").single();
  await admin.from("user_roles").insert({ user_id: userId, role_id: role.id });
  await admin
    .from("profiles")
    .update({ approval_status: "approved", account_status: "active", registration_source: "admin_created", approved_at: new Date().toISOString() })
    .eq("id", userId);
  return { email, password, remove: () => admin.auth.admin.deleteUser(userId) };
}

/** Demo records to open, so profile pictures show demo people rather than real ones. */
async function demoIds() {
  if (!admin) return {};
  const first = async (table, build) => (await build(admin.from(table).select("id")).limit(1).maybeSingle()).data?.id ?? null;
  return {
    member: await first("people", (q) => q.eq("person_type", "member").eq("is_demo", true).order("member_code")),
    visitor: await first("people", (q) => q.eq("person_type", "visitor").eq("is_demo", true).order("created_at")),
    group: await first("cell_groups", (q) => q.eq("is_demo", true).is("archived_at", null).order("name")),
    ministry: await first("ministries", (q) => q.is("archived_at", null).order("sort_order")),
    event: await first("events", (q) => q.eq("is_demo", true).order("event_date", { ascending: false })),
    session: await first("attendance_sessions", (q) => q.eq("is_demo", true).order("session_date", { ascending: false })),
  };
}

// --- in-page helpers -------------------------------------------------------------------------

/** Replaces email addresses and mobile numbers on screen with placeholders (display only). */
const MASK = `(() => {
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;
  const phone = /(\\+?63|0)9\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{4}/g;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    const next = text.replace(email, "name@example.com").replace(phone, "09XX XXX XXXX");
    if (next !== text) node.nodeValue = next;
  }
  for (const input of document.querySelectorAll("input")) {
    if (email.test(input.value)) input.value = "name@example.com";
    email.lastIndex = 0;
  }
})()`;

/** Finds a visible element by its text (buttons, links, headings, labels) or a CSS selector. */
const FIND = `(query) => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  if (query.startsWith("css:")) return [...document.querySelectorAll(query.slice(4))].find(visible) ?? null;
  // "tab:Name" — only tabs, so a menu heading with the same word is never picked instead.
  if (query.startsWith("tab:")) return [...document.querySelectorAll("[role=tab]")].filter(visible).find((el) => el.textContent.trim().toLowerCase() === query.slice(4).toLowerCase()) ?? null;
  const wanted = query.toLowerCase();
  const candidates = [...document.querySelectorAll("button, a, [role=tab], [role=button], h1, h2, h3, label, summary, input, p, span")];
  const text = (el) => (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "").trim().toLowerCase();
  return candidates.filter(visible).find((el) => text(el) === wanted) ?? candidates.filter(visible).find((el) => text(el).includes(wanted)) ?? null;
}`;

/** Numbered red markers next to elements, for the numbered lists in the manual. */
const ANNOTATE = (marks) => `(() => {
  const find = ${FIND};
  const found = [];
  ${JSON.stringify(marks)}.forEach((query, index) => {
    const el = find(query);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const badge = document.createElement("div");
    badge.textContent = String(index + 1);
    badge.setAttribute("data-docs-marker", "");
    Object.assign(badge.style, {
      position: "fixed", zIndex: 2147483647,
      // Beside the element (left of it, or right when there is no room), never over its text.
      left: (r.left >= 34 ? r.left - 30 : r.right + 6) + "px", top: Math.max(2, r.top + r.height / 2 - 12) + "px",
      width: "24px", height: "24px", borderRadius: "999px", background: "#dc2626", color: "#fff",
      font: "700 13px/24px system-ui, sans-serif", textAlign: "center", boxShadow: "0 0 0 2px #fff, 0 2px 6px rgb(0 0 0 / .35)",
    });
    document.body.appendChild(badge);
    found.push(query);
  });
  return found;
})()`;

// --- the pictures --------------------------------------------------------------------------------

/**
 * Each shot: folder/name, the page, and optionally what to do first (click a
 * button by its text, scroll to a heading), markers, full-page, phone size.
 */
function shots(ids) {
  const member = ids.member ? `/people/members/${ids.member}` : null;
  const visitor = ids.visitor ? `/people/visitors/${ids.visitor}` : null;
  return [
    // Signing in (no account needed)
    { file: "authentication/login", path: "/login", public: true, marks: ["css:#email", "css:#password", "Remember my email", "Sign In", "Forgot password?", "Create an account"] },
    { file: "authentication/sign-up", path: "/sign-up", public: true, full: true },
    { file: "authentication/forgot-password", path: "/forgot-password", public: true },
    { file: "mobile/login", path: "/login", public: true, phone: true },
    { file: "mobile/sign-up", path: "/sign-up", public: true, phone: true },

    // Dashboard and navigation
    { file: "dashboard/dashboard", path: "/dashboard", full: true },
    { file: "dashboard/navigation", path: "/dashboard", marks: ["Dashboard", "Members", "Services", "Cell Groups", "Follow-ups", "Finance", "Users"] },
    { file: "dashboard/command-palette", path: "/dashboard", keys: "k", wait: 600 },
    { file: "dashboard/notifications", path: "/dashboard", click: "css:button[aria-label^='Notifications']", wait: 600 },

    // People
    { file: "members/members-list", path: "/people/members", marks: ["Add member", "css:input[placeholder^='Search name']", "Status: All"] },
    { file: "members/add-member", path: "/people/members/new", full: true },
    member && { file: "members/member-profile", path: member, full: true },
    member && { file: "members/member-attendance-tab", path: member, click: "tab:Attendance" },
    { file: "members/birthdays", path: "/people/birthdays" },
    { file: "visitors/visitors-list", path: "/people/visitors" },
    { file: "visitors/register-visitor", path: "/people/visitors/new", full: true },
    visitor && { file: "visitors/visitor-profile", path: visitor, full: true },

    // Attendance
    { file: "attendance/services", path: "/attendance/services" },
    { file: "attendance/new-session", path: "/attendance/services?new=1", wait: 600 },
    ids.session && { file: "attendance/record-attendance", path: `/attendance/services/${ids.session}`, full: true },
    { file: "attendance/records", path: "/attendance/records" },
    { file: "attendance/history", path: "/attendance/history" },

    // Groups, care, growth
    { file: "groups/cell-groups", path: "/groups" },
    ids.group && { file: "groups/cell-group-details", path: `/groups/${ids.group}`, full: true },
    { file: "care/follow-ups", path: "/care/follow-ups" },
    { file: "care/new-follow-up", path: "/care/follow-ups?new=1", wait: 600 },
    { file: "care/new-care-record", path: "/care/pastoral?new=1", wait: 600 },
    { file: "discipleship/discipleship-list", path: "/discipleship" },
    member && { file: "discipleship/discipleship-profile", path: `/discipleship/${ids.member}`, full: true },
    { file: "ministries/ministries-list", path: "/ministries" },
    ids.ministry && { file: "ministries/ministry-details", path: `/ministries/${ids.ministry}`, full: true },
    { file: "events/events-list", path: "/events" },
    { file: "events/events-calendar", path: "/events?view=calendar" },
    ids.event && { file: "events/event-details", path: `/events/${ids.event}` },

    // Finance
    { file: "finance/finance-dashboard", path: "/finance", full: true },
    { file: "finance/giving", path: "/finance/giving", marks: ["Collections", "Add giving", "New collection"] },
    { file: "finance/add-giving", path: "/finance/giving?new=1", wait: 600 },
    { file: "finance/collections", path: "/finance/giving/collections" },
    { file: "finance/new-collection-summary", path: "/finance/giving/collections/new", full: true },
    { file: "finance/new-collection-detailed", path: "/finance/giving/collections/new", click: "css:input[name=entry_mode]:not(:checked)", full: true },
    { file: "finance/expenses", path: "/finance/expenses" },
    { file: "finance/transfers", path: "/finance/transfers" },
    { file: "finance/finance-settings", path: "/finance/settings", full: true },

    // Reports
    { file: "reports/reports-center", path: "/reports" },
    { file: "reports/membership-report", path: "/reports/membership" },
    { file: "reports/account-transactions-report", path: "/reports/account-transactions" },

    // Administration
    { file: "administration/users", path: "/admin/users" },
    { file: "administration/add-user", path: "/admin/users", click: "Add user", wait: 600 },
    { file: "administration/account-approvals", path: "/admin/approvals" },
    { file: "administration/roles-permissions", path: "/admin/roles", full: true },
    { file: "administration/activity-logs", path: "/admin/activity-logs" },
    { file: "administration/my-profile", path: "/profile", full: true },
    member && { file: "members/account-access", path: member, scrollTo: "Account access" },

    // Settings
    { file: "settings/general", path: "/admin/settings" },
    { file: "settings/branding", path: "/admin/settings", click: "tab:Branding & Appearance" },
    { file: "settings/login-page-content", path: "/admin/settings", click: "tab:Branding & Appearance", scrollTo: "Login page content" },
    { file: "settings/background", path: "/admin/settings", click: "tab:Branding & Appearance", scrollTo: "Background preview" },
    { file: "settings/colours", path: "/admin/settings", click: "tab:Branding & Appearance", scrollTo: "Colours" },
    { file: "settings/typography", path: "/admin/settings", click: "tab:Branding & Appearance", scrollTo: "Typography preview" },
    { file: "settings/motion", path: "/admin/settings", click: "tab:Branding & Appearance", scrollTo: "Motion preview" },

    // Phone
    { file: "mobile/dashboard", path: "/dashboard", phone: true },
    { file: "mobile/more-menu", path: "/dashboard", phone: true, click: "More", wait: 600 },
    { file: "mobile/members", path: "/people/members", phone: true },
    member && { file: "mobile/member-profile", path: member, phone: true },
    ids.session && { file: "mobile/record-attendance", path: `/attendance/services/${ids.session}`, phone: true },
    { file: "mobile/follow-ups", path: "/care/follow-ups", phone: true },
    { file: "mobile/giving", path: "/finance/giving", phone: true },
    { file: "mobile/new-collection", path: "/finance/giving/collections/new", phone: true, full: true },
    { file: "mobile/command-select", path: "/people/members/new", phone: true, click: "css:#gender", wait: 600 },
  ].filter(Boolean);
}

// --- running ------------------------------------------------------------------------------------

async function main() {
  let account = null;
  let cleanup = null;
  const publicOnly = flag("--public-only");
  if (!publicOnly) {
    if (flag("--temp-admin")) {
      account = await temporaryAdmin();
      cleanup = account.remove;
      console.log("Signed in with a temporary documentation account (deleted at the end).");
    } else if (process.env.DOCS_EMAIL && process.env.DOCS_PASSWORD) {
      account = { email: process.env.DOCS_EMAIL, password: process.env.DOCS_PASSWORD };
    } else {
      throw new Error("Set DOCS_EMAIL and DOCS_PASSWORD in .env.local, or pass --temp-admin, or --public-only.");
    }
  }

  // Two browser profiles: one never signed in (sign-in pages), one signed in (everything else).
  const signedOut = mkdtempSync(join(tmpdir(), "jamc-docs-out-"));
  const signedIn = mkdtempSync(join(tmpdir(), "jamc-docs-in-"));
  const done = [];
  const skipped = [];

  async function capture(shot, profile) {
    const page = await openPage(profile);
    const { send, evaluate, size, go, findAnd } = page;
    try {
      await size(shot.phone ? PHONE : DESKTOP);
      await go(shot.path);
      if (shot.click) {
        const clicked = await findAnd(shot.click, "el.click()");
        if (!clicked) throw new Error(`could not find "${shot.click}"`);
        await sleep(shot.wait ?? 900);
      }
      if (shot.keys) {
        const key = { key: shot.keys, code: `Key${shot.keys.toUpperCase()}`, modifiers: 2, windowsVirtualKeyCode: shot.keys.toUpperCase().charCodeAt(0) };
        await send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
        await sleep(shot.wait ?? 600);
      }
      if (shot.scrollTo) {
        const scrolled = await findAnd(shot.scrollTo, `el.scrollIntoView({ block: "start" }); window.scrollBy(0, -80)`);
        if (!scrolled) throw new Error(`could not find "${shot.scrollTo}"`);
        await sleep(500);
      }
      // Let the page finish starting up before touching its text, then hide emails and mobile numbers.
      await sleep(1200);
      await evaluate(MASK);
      if (shot.marks) await findAnd(shot.marks[0], "void 0");
      const marked = shot.marks ? await evaluate(ANNOTATE(shot.marks)) : [];

      let clip;
      if (shot.full) {
        const height = await evaluate("Math.min(document.documentElement.scrollHeight, 6000)");
        const width = shot.phone ? PHONE.width : DESKTOP.width;
        await size({ ...(shot.phone ? PHONE : DESKTOP), height });
        await sleep(400);
        // Anything that loaded with the taller page is hidden too.
        await evaluate(MASK);
        clip = { x: 0, y: 0, width, height, scale: 1 };
      }
      const { data } = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      const file = join(OUT, `${shot.file}.png`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(data, "base64"));
      done.push({ file: `${shot.file}.png`, path: shot.path, marks: marked });
      const missing = shot.marks && marked.length !== shot.marks.length ? `  (markers found: ${marked.length}/${shot.marks.length})` : "";
      console.log(`saved  ${shot.file}.png${missing}`);
    } catch (error) {
      skipped.push({ file: `${shot.file}.png`, reason: error.message });
      console.log(`skip   ${shot.file}.png  (${error.message})`);
    } finally {
      await page.close();
    }
  }

  try {
    const list = shots(publicOnly ? {} : await demoIds())
      .filter((shot) => (publicOnly ? shot.public : true))
      .filter((shot) => !ONLY || shot.file.startsWith(`${ONLY}/`))
      .filter((shot) => !FILES || FILES.includes(shot.file));

    for (const shot of list.filter((item) => item.public)) await capture(shot, signedOut);

    if (account) {
      const page = await openPage(signedIn);
      try {
        await page.size(DESKTOP);
        await page.go("/login");
        await page.evaluate(`(() => {
          const set = (selector, value) => {
            const input = document.querySelector(selector);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          };
          set("#email", ${JSON.stringify(account.email)});
          set("#password", ${JSON.stringify(account.password)});
          document.querySelector("form button[type=submit]").click();
        })()`);
        for (let i = 0; i < 80; i += 1) {
          await sleep(250);
          if (!(await page.evaluate("location.pathname").catch(() => "/login")).startsWith("/login")) break;
        }
        if ((await page.evaluate("location.pathname")).startsWith("/login")) throw new Error("Sign-in failed. Check DOCS_EMAIL and DOCS_PASSWORD.");
        if (option("--debug-path", null)) {
          await page.go(option("--debug-path"));
          console.log(JSON.stringify(await page.evaluate(option("--debug-expr", "document.title")), null, 1));
          return;
        }
      } finally {
        await page.close();
      }

      for (const shot of list.filter((item) => !item.public)) await capture(shot, signedIn);
      const retry = skipped.splice(0).map((item) => list.find((shot) => `${shot.file}.png` === item.file)).filter(Boolean);
      if (retry.length) console.log(`\nRetrying ${retry.length} skipped…`);
      for (const shot of retry) await capture(shot, signedIn);
    }
  } finally {
    if (cleanup) await cleanup().catch((error) => console.error("Could not delete the temporary account:", error.message));
    for (const profile of [signedOut, signedIn]) {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    }
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ capturedAt: new Date().toISOString(), base: BASE, done, skipped }, null, 2));
  console.log(`\n${done.length} screenshots saved in ${OUT}. ${skipped.length ? `Skipped: ${skipped.map((s) => s.file).join(", ")}` : ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
