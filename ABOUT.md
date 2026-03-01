# Fegis — CheeseHacks 2026 Submission

> Built at CheeseHacks 2026 · February 28 – March 1, 2026

---

## Project Title & Description

**Fegis** is a Chrome extension that acts as a privacy firewall between you and AI chatbots. It scans your messages in real time, highlights every piece of personally identifiable information (PII) it finds, and lets you replace it with safe tokens or realistic fake data before anything leaves your browser — all locally, with zero external requests.

---

## GitHub Repository

🔗 **[github.com/TODO/fegis](https://github.com/TODO/fegis)**

Setup instructions are in [`README.md`](./README.md).

---

## Live Demo / Video

🌐 **Live demo:** [TODO — deployed URL]

🎥 **Video walkthrough:** [TODO — YouTube/Vimeo link]

---

## Team Members

- TODO — add team members

---

## Technologies Used

`TypeScript` `React 19` `Vite 7` `Chrome Extensions MV3` `pdfjs-dist` `Bun` `Tailwind CSS`

---

## Built at CheeseHacks

This project was built entirely during CheeseHacks 2026 (February 28 – March 1, 2026). ✅

---

## Inspiration

AI assistants are part of everyday work now — people paste in meeting notes, support tickets, internal docs, and debugging logs without thinking twice. But those messages contain real names, email addresses, phone numbers, credit card numbers, and API keys that get sent to third-party servers and used for training data. There's no friction, no warning, nothing.

We wanted to build the thing that *should already exist*: a quiet layer that watches what you're about to send, flags anything sensitive, and gives you a one-click way to clean it up. Like a spell checker, but for privacy.

---

## What It Does

Fegis installs as a Chrome extension and works silently in the background on ChatGPT, Gemini, Claude, Copilot, Grok, DeepSeek, and any site with a standard text input.

As you type, it runs your message through 9 specialized detectors covering names, emails, phone numbers, financial data (with Luhn validation), SSNs, addresses, API keys, URLs, IDs, dates, file paths, and log entries. Anything suspicious gets color-coded highlights directly in the input box.

Before you hit send, you can choose how to handle flagged content:
- **Tokens mode** — replaces PII with structured placeholders like `[NAME_1]` and `[EMAIL_2]`. The AI never sees the real data, and responses with tokens can be automatically unmasked back to the originals in your browser.
- **Fake data mode** — swaps in deterministically generated realistic-looking fake values. Same original always produces the same fake, so conversations stay consistent.

There's also a companion website with an interactive demo where you can paste text or upload a PDF and see the detection engine work in real time.

---

## How We Built It

The extension runs across four execution contexts that each handle a distinct concern:

**Content script (isolated world)** monitors input elements, runs text through the detection engine on every keystroke (debounced), and renders transparent highlight overlays directly on top of the textarea using z-indexed positioned spans.

**Fetch interceptor (main world)** is injected before any page scripts run and wraps the native `fetch`, `XMLHttpRequest`, and `WebSocket` APIs. This lets us intercept outgoing requests at the lowest level, apply replacements to the body, and optionally unmask incoming responses — without the page ever knowing.

**Service worker** handles settings persistence via `chrome.storage`, maintains the token/replacement maps in session storage, and broadcasts changes to all active tabs.

**Popup UI** is a React app for toggling the extension, switching modes, managing custom blocklists, and reviewing the replacement map for the current session.

The detection engine is a pipeline of pattern matchers. Each detector has its own scoring logic, and overlapping matches are resolved by confidence score. The fake data generator uses a DJB2 hash of the original value as a seed so replacements are deterministic — the same SSN always generates the same fake one, formatted identically.

The website shares the same detection engine via a Vite path alias (`@extension → ../extension/src`), so the live demo is always in sync with the actual extension.

---

## Challenges We Ran Into

**Getting into the main world before the page.** Modern AI chat apps use complex JavaScript frameworks that patch `fetch` and `XMLHttpRequest` themselves. We had to inject the interceptor via `web_accessible_resources` with `world: "MAIN"` at `document_start` to win the race condition and wrap the native APIs before any page script could.

**Site adapter fragility.** Every AI platform structures its input differently. ChatGPT uses a `contenteditable` div, Claude uses ProseMirror, Gemini uses a custom element. Building per-site adapters without them breaking on every UI update required writing robust fallbacks and frequent testing.

**Highlight overlay alignment.** Overlaying colored spans on a textarea without disrupting the user's ability to type, select, and scroll was surprisingly hard. The overlay has to match the textarea's font, line height, padding, scrollTop, and word-wrap exactly — any mismatch and the highlights drift. We ended up syncing scroll position on every input event.

**Keeping fake data consistent.** The AI needs to receive consistent fake values across a conversation — if you paste a name twice, it needs to always map to the same fake name. We solved this with deterministic hashing so there's no state that needs to be persisted mid-conversation.

---

## Accomplishments That We're Proud Of

- **Zero external requests.** Everything — detection, tokenization, fake generation — runs locally in the browser. No API calls, no telemetry, no backend.
- **13 PII categories** detected with a single pass through an efficient scoring pipeline.
- **Cross-platform support** for 6 major AI platforms out of the box, with a generic fallback that works on most other sites.
- **PDF scanning in the demo.** The website demo lets you drop a PDF and see every piece of PII extracted and highlighted in seconds, using the exact same engine as the extension.
- **Response unmasking.** Being able to send tokenized messages and then see real names restored in the AI's reply — without the AI ever touching the real data — was a technically satisfying problem to solve.

---

## What We Learned

Building a browser extension that touches network requests taught us a lot about the browser's security model and why certain things are hard on purpose. The separation between isolated worlds and the main world exists for good reasons, and working within those constraints (rather than around them) kept the extension genuinely safe.

We also learned that PII detection is harder than regex. Names are context-dependent, dates are ambiguous, phone number formats vary by country, and API keys look different across every provider. The gap between "catches most things" and "catches everything with zero false positives" is huge — we spent a lot of time tuning confidence scores and testing edge cases.

---

## What's Next for Fegis

- **Firefox support** — port the MV3 manifest to MV2 for Firefox compatibility
- **More platforms** — Slack, Notion, Linear, email clients
- **Smarter name detection** — the current approach misses uncommon names and flags some common words; a lightweight local ML model would help
- **Org-wide deployment** — a managed configuration option so IT teams can push a standard blocklist to all employees
- **Audit log** — an optional local log of what was detected and masked per session, exportable for compliance workflows
- **Firefox / Safari extensions** — expand beyond Chrome
