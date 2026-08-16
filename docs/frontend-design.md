# frontend-design.md

## 1. Two surfaces, opposite goals

|  | Marketing site | Front-desk app |
| --- | --- | --- |
| Audience | Clinic owners you are pitching | Reception staff, daily, under pressure |
| Goal | Make them feel the cost of an empty chair | Fill a chair in under 15 seconds |
| Aesthetic | Cinematic, dark, Veo 3 video | Calm, bright, fast, near-zero motion |
| Performance | LCP < 2.5s acceptable | LCP < 1.5s required |
| Ships to client | No — stays yours, reused per clinic | Yes — handed over |

<aside>
🎯

**Do not put hero video in the dashboard.** Staff open it mid-cancellation on an old reception PC. Video costs megabytes, delays interaction, and becomes irritating by day three. Video belongs on the marketing site and, at most, in a first-run onboarding tour.

</aside>

## 2. Design principles for the app

1. **One primary action per screen.** On the dashboard that is "Fill a chair." Everything else is secondary.
2. **State is always visible.** A staff member should never wonder whether a text went out.
3. **Destructive and irreversible actions are slow.** Cancel a campaign, flip the kill switch → confirmation required. Sending is irreversible; treat it that way.
4. **No spinner without a skeleton.** Layout must not shift when data arrives.
5. **Legible at arm's length.** 16px minimum body text, 44px minimum touch targets. Reception monitors are far away and often scaled.
6. **Motion communicates, never decorates.** The only animations that earn their place are wave-progress and new-message arrival.

## 3. Design tokens

```css
@theme {
  /* Surface — warm neutral, not clinical blue-grey */
  --color-bg:            oklch(99% 0.004 250);
  --color-surface:       oklch(100% 0 0);
  --color-surface-sunken:oklch(97% 0.006 250);
  --color-border:        oklch(92% 0.008 250);
  --color-border-strong: oklch(85% 0.010 250);

  /* Text */
  --color-fg:            oklch(21% 0.015 260);
  --color-fg-muted:      oklch(52% 0.015 260);
  --color-fg-subtle:     oklch(65% 0.012 260);

  /* Brand — teal reads medical-adjacent without being cold */
  --color-brand:         oklch(58% 0.13 195);
  --color-brand-hover:   oklch(52% 0.13 195);
  --color-brand-subtle:  oklch(96% 0.03 195);

  /* Semantic */
  --color-success:       oklch(62% 0.15 150);
  --color-warning:       oklch(75% 0.15 75);
  --color-danger:        oklch(58% 0.20 25);
  --color-info:          oklch(60% 0.14 255);

  /* Type */
  --font-sans: "Inter var", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --text-xs: 0.8125rem;   /* 13px — metadata only */
  --text-sm: 0.875rem;    /* 14px */
  --text-base: 1rem;      /* 16px — body floor */
  --text-lg: 1.125rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.75rem;
  --text-3xl: 2.25rem;    /* dashboard metrics */

  /* Radius + elevation */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --shadow-sm: 0 1px 2px oklch(21% 0.015 260 / 0.05);
  --shadow-md: 0 4px 12px oklch(21% 0.015 260 / 0.08);
  --shadow-lg: 0 12px 32px oklch(21% 0.015 260 / 0.12);
}
```

Spacing uses Tailwind's 4px scale. Only these steps: `1, 2, 3, 4, 6, 8, 12, 16, 24`. Content max-width `1440px`; text columns cap at `72ch`.

## 4. Status color mapping

This mapping is load-bearing — staff learn it by color before they read the label. Use it identically everywhere.

| Status | Color | Dot | Label |
| --- | --- | --- | --- |
| `DRAFT` | `fg-subtle` | hollow | Draft |
| `OPEN` | `info` | solid, pulsing | Sending wave 1 |
| `ESCALATING` | `warning` | solid, pulsing | Wave 2 of 3 |
| `PENDING_PAYMENT` | `brand` | solid | Awaiting deposit |
| `FILLED` | `success` | solid | Filled — [name] |
| `EXPIRED` | `fg-subtle` | hollow | Not filled |
| `CANCELLED` | `fg-subtle` | hollow with slash | Cancelled |

Delivery states: `DELIVERED` success, `SENT`/`QUEUED` muted, `UNDELIVERED`/`FAILED` danger with the Twilio error code available on hover.

<aside>
♿

Never encode meaning in color alone. Every status pill carries a text label and a distinct dot shape, because roughly 1 in 12 men has a color vision deficiency and this app makes money decisions.

</aside>

## 5. App shell

```
┌───────────┬────────────────────────────────────┐
│ 🦷 Clinic  │  Header: clinic name · kill-switch banner  │
│            ├─────────────────────────────────────┤
│ Dashboard  │                                            │
│ Inbox  (3) │            Page content                    │
│ Patients   │                                            │
│ Settings   │                                            │
│            │                                            │
│ ────────── │                                            │
│ User menu  │                                            │
└───────────┴────────────────────────────────────┘
```

Sidebar is 240px, collapses to icons under 1024px, becomes a bottom tab bar under 768px. The inbox badge is live via Realtime. When `automation_paused` is true, a **persistent danger banner** spans the header on every page — it must be impossible to forget the kill switch is on.

## 6. Screen specs

### 6.1 Dashboard — `/dashboard`

The only screen most staff will ever look at. Layout top to bottom:

1. **Primary action bar.** A single large `Fill a chair` button, brand-colored, 48px tall, always in the same place. Keyboard shortcut `N`.
2. **Metric row** — four cards, `text-3xl` numbers with `text-sm` muted labels:
    - Chairs filled this month
    - Median time to fill (e.g. `4m 12s`)
    - Est. revenue recovered (with an `Estimate` tooltip explaining chair value × fills)
    - Delivery rate (with failed count as a danger sub-label if non-zero)
3. **Active campaigns** — the live section. One card per campaign showing appointment time in clinic-local time, procedure label, status pill, wave progress (`●●○` wave 2 of 3), a live countdown to the next wave, recipient count, and inline `Pause` / `Cancel` / `Fill manually` actions. Sorted by appointment time ascending.
4. **Stalled warning.** If a campaign is `OPEN`/`ESCALATING` past its expected next-wave time by more than two minutes, show an amber inline alert: *"Wave may not have sent — check automation."* This is the clinic's only signal that n8n is down.
5. **Recent outcomes** — last 10 resolved campaigns, compact rows, filled/expired/cancelled.

Empty state: an illustration, *"No open slots. When someone cancels, come back here."* plus the primary button.

### 6.2 Fill a chair — modal or `/campaigns/new`

Three steps, no more. Total time budget: 15 seconds.

1. **Slot template** — large one-tap preset buttons (`Hygiene — 60 min`, `Crown — 90 min`, `Emergency — 30 min`). Not a dropdown; tapping is faster than selecting.
2. **Time** — defaults to the next round half-hour. Quick chips: `Today 10:00`, `Today 14:00`, `Tomorrow …`, plus a manual picker. Always render clinic-local time with the timezone abbreviation.
3. **Confirm** — shows *"Wave 1 will text 3 patients now. 47 eligible in total."* Then a single `Send` button.

If outside quiet hours, replace `Send` with a disabled state and a clear message: *"Outside sending hours (8:00–20:00). Scheduled for 8:00 tomorrow."* Never silently defer.

### 6.3 Campaign detail — `/campaigns/[id]`

Header with appointment time, procedure, status pill, and actions. Then a **vertical wave timeline** — the most important component in the app:

```
● Wave 1 · 3 patients · sent 10:02
  │ Sarah M.  •••1234   Delivered 10:02
  │ James O.  •••8876   Delivered 10:02
  │ Priya R.  •••4421   Failed  ⚠ 30007
● Wave 2 · 5 patients · sent 10:09
  │ …
○ Wave 3 · 10 patients · in 4m 31s   [Pause]
```

Below: the winner card if filled (name, phone, claim time, confirmation status), and an audit trail from `audit_events` in plain language — *"Cancelled by Dana at 10:14."*

Show only the last four digits of phone numbers in list views; full number on the patient detail page only.

### 6.4 Inbox — `/inbox`

Two-pane on desktop, stacked on mobile. Left: conversation list with unread emphasis (brand left-border plus semibold name), patient name, message preview, relative timestamp. Right: the message thread from `sms_logs` — outbound right-aligned muted, inbound left-aligned surface, with delivery ticks and timestamps.

Composer at the bottom with a character counter that warns past 160 (segment boundary = extra cost). Actions: `Assign to…`, `Resolve`, `View patient`. New messages arrive via Realtime with a subtle slide-in — the one place motion is genuinely useful.

### 6.5 Patients — `/patients`

Searchable table, 50 per page: name, last four of phone, consent pill, opted-out flag, reliability score with a small bar, last visit. Filter chips: `Eligible`, `Opted out`, `No consent`, `Due for recall`. Prominent `Import CSV` button.

Patient detail drawer: full phone, consent history, message history, campaigns offered vs. claimed, and the reliability score **broken into its components** so staff can see and override the reasoning.

### 6.6 CSV import — `/patients/import`

Four-step wizard with a visible progress indicator:

1. **Drop zone** — large dashed area, `Drop your Dentrix or Eaglesoft export here`. Note in muted text: *"Your file is read in your browser and never uploaded."* That sentence is a trust feature; keep it.
2. **Column mapping** — side-by-side: their headers, your fields, with a sample value from row 1 under each. Required fields marked. No auto-advance.
3. **Preview** — counts as four cards (valid / invalid / duplicates / will update), plus a scrollable table of invalid rows with a specific reason per row (`Not a valid phone number`, `Missing name`). Let them download the invalid rows as CSV to fix.
4. **Result** — inserted, updated, skipped, invalid, with a link back to the patient list.

### 6.7 Settings — `/settings`

Sections: Clinic (name, timezone), Sending (quiet hours, weekly cap), Waves (visual wave-plan editor — rows of size + delay, add/remove), Slot templates (CRUD, drag to reorder), Money (chair value), Recalls (threshold, cooldown), Staff (invite, role, deactivate), Feature flags, and **Danger zone**.

Danger zone holds the kill switch: full-width danger-bordered card, explicit label *"Pause all outgoing messages"*, a toggle requiring typed confirmation, and the current state stated in words. When enabled, show who enabled it and when.

## 7. Component inventory

Every component ships with all five states: default, loading (skeleton), empty, error, disabled.

| Component | Notes |
| --- | --- |
| `StatusPill` | Dot shape + label + color, from the section 4 mapping |
| `MetricCard` | Big number, label, optional trend, optional estimate tooltip |
| `CampaignCard` | Status, time, wave progress, countdown, inline actions |
| `WaveTimeline` | Vertical, per-recipient delivery state |
| `CountdownTimer` | Client component, `setInterval` 1s, cleans up on unmount |
| `SlotTemplatePicker` | Large tap targets, keyboard-navigable |
| `PhoneDisplay` | Masks to last four by default, `reveal` prop for detail pages |
| `ConsentBadge` | Granted / Unknown / Revoked |
| `MessageThread` | Bubbles, delivery ticks, segment-aware composer |
| `CsvDropzone` | Drag state, parse progress, size guard |
| `ColumnMapper` | Header → field with sample values |
| `ConfirmDialog` | Typed confirmation variant for destructive actions |
| `KillSwitchBanner` | Persistent, header-level, danger |
| `EmptyState` | Illustration, one sentence, one action |
| `ErrorBoundary` | Plain-language message, retry, never a raw stack trace |

## 8. Motion

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--dur-fast: 120ms;   /* hover, focus */
--dur-base: 200ms;   /* dialogs, drawers */
--dur-slow: 320ms;   /* new message slide-in */
```

Permitted: status pill pulse on active campaigns (2s ease-in-out, opacity only), new inbox message slide-in, dialog fade+scale, skeleton shimmer, countdown tick. Everything else is static.

Wrap all of it:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 9. Marketing site and Veo 3 video

### Where video goes

Hero only, plus optionally one section loop. Never on the dashboard. Never with sound.

### Working with Veo 3's real output

Veo 3 produces ~8-second clips at 720p/1080p, 16:9, with generated audio. Plan around that:

- **Design for an 8s loop.** Prompt for a shot that starts and ends on a similar frame, or stitch 2–3 clips with hard cuts — cuts hide seams better than crossfades.
- **Strip the audio.** Browsers block autoplay on unmuted video, and the track is dead weight.
- **Slow camera, shallow depth of field.** Fast motion compresses badly and exposes AI artifacts.
- **No on-screen text, no faces in focus.** Veo mangles text; generic AI faces read as cheap.
- Generate 3–4 variants per concept. Roughly one in six is free of tells. Prompts are in `prompt.md`.

### Encode before shipping

Never commit a raw Veo export — they run 20MB+.

```bash
# H.264 MP4 — universal fallback, audio stripped
ffmpeg -i veo-raw.mp4 -an -vf "scale=1920:-2" \
  -c:v libx264 -crf 26 -preset slow -profile:v high \
  -movflags +faststart hero.mp4

# WebM/VP9 — ~30% smaller for Chrome and Firefox
ffmpeg -i veo-raw.mp4 -an -vf "scale=1920:-2" \
  -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 hero.webm

# Poster frame — instant paint and the reduced-motion fallback
ffmpeg -i veo-raw.mp4 -vf "select=eq(n\,0)" -vframes 1 -q:v 2 hero-poster.jpg
```

Budget: **under 2.5MB** per loop. `+faststart` moves metadata to the front so playback begins before download completes.

### Host it off Vercel

Do not put video in `/public` — every visit burns Vercel bandwidth. Use Cloudflare R2 (zero egress) or Supabase Storage. Mux or Cloudflare Stream only if you want adaptive bitrate, which a single 8s loop does not need.

### The component

```tsx
export function HeroVideo() {
  return (
    <div className="relative h-[85vh] w-full overflow-hidden">
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="https://cdn.example.com/hero-poster.jpg"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
      >
        <source src="https://cdn.example.com/hero.webm" type="video/webm" />
        <source src="https://cdn.example.com/hero.mp4" type="video/mp4" />
      </video>

      <img
        src="https://cdn.example.com/hero-poster.jpg"
        alt=""
        className="absolute inset-0 hidden h-full w-full object-cover motion-reduce:block"
      />

      {/* Scrim — never put text directly on video */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-slate-950/20" />

      <div className="relative z-10 flex h-full flex-col justify-center px-8">
        <h1 className="max-w-3xl text-5xl font-semibold text-white">
          Fill the empty chair in 90 seconds.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-slate-300">
          One click texts your waitlist. First reply wins the slot.
        </p>
      </div>
    </div>
  )
}
```

The four attributes required for autoplay: `autoPlay muted loop playsInline`. Omit `playsInline` and iOS Safari goes fullscreen instead of playing inline.

<aside>
⚖️

Keep marketing video generic and unbranded so it is reusable across every clinic you pitch. Real patients or a specific clinic's branding means consent and licensing obligations.

</aside>

## 10. Accessibility

- WCAG 2.1 AA contrast: 4.5:1 body, 3:1 large text and UI boundaries.
- Full keyboard operation. Visible focus rings — never `outline: none` without a replacement.
- Shortcuts: `N` new campaign, `G then I` inbox, `/` search, `Esc` close.
- Semantic landmarks: `<nav>`, `<main>`, `<aside>`. One `<h1>` per page.
- Every form input has a real `<label>`; errors linked with `aria-describedby`.
- New inbox messages announce via a polite `aria-live` region.
- Tables use `<caption>` and `<th scope>`. Sorting state via `aria-sort`.
- Decorative video and illustrations are `aria-hidden` with empty `alt`.

## 11. Performance budgets

| Route | LCP | JS (gzipped) |
| --- | --- | --- |
| `/dashboard` | < 1.5s | < 180KB |
| `/inbox` | < 1.8s | < 200KB |
| `/patients` | < 1.5s | < 160KB |
| Marketing hero | < 2.5s | < 120KB + video |

How: Server Components by default; `"use client"` only on the countdown, Realtime subscriber, CSV parser, and composer. Dynamically import Papa Parse so it loads only on the import route. `next/font` with `display: swap`. No icon library barrel imports — import individual icons. No chart library in V1; the wave timeline and progress bars are CSS.

## 12. Copy tone

- **App:** plain, calm, specific. *"Wave 2 sent to 5 patients."* Not *"Broadcast dispatched successfully!"* No exclamation marks. No jargon like "campaign" in patient-facing copy.
- **Errors:** say what happened and what to do. *"Couldn't send — Twilio rejected the number. Check the patient's phone."* Never a stack trace or an error code alone.
- **SMS:** short, no clinical detail, clinic name first, clear reply instruction, opt-out language on first contact. *"Hillside Dental: an opening today at 10:00 AM. Reply YES to claim it. Reply STOP to opt out."*
- **Marketing:** concrete numbers, not adjectives. *"An empty chair costs $200–$500 an hour."*