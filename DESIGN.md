# Fantasy Bake Off — Design Guidelines

*Draft v0.1 — a starting point to edit, not a finished system. §3 marks which
parts are taste and which are load-bearing.*

---

## 1. The idea

A **paper tent noticeboard**, not a sports app. Warm off-white ground, soft
pastel accents, one loud colour reserved for "this is happening right now".
Generous whitespace, rounded corners, nothing that looks like a trading terminal.

The trap to avoid is literal bunting and gingham everywhere. The show's own
design is restrained — pastel is the *ground*, and the tent reads as warm because
of paper, light and space, not because of decoration.

**Mobile first.** Most people are on a phone on the sofa. Big screens get more
room, not a different design.

---

## 2. The one rule that shapes everything

> **The page is pastel. The data is not.**

Pastels are lovely for surfaces and terrible for identity: wash a colour out and
it stops being distinguishable, which is precisely what a chart line or a
leaderboard chip has to do. So there are **two colour layers**, and they are
different values of the same hue:

| Layer | Where | Character |
|-------|-------|-----------|
| **Tints** | avatar bodies, card washes, section backgrounds, the ground | Soft, low-chroma, large areas |
| **Series hues** | chart lines, leaderboard chips, dots, anything small that must be told apart | Saturated, small areas, validated |

A player's avatar is a lightened variant of their series hue, computed in CSS —
one stored value, two appearances. (Same decision as TECH_PLAN §7.)

---

## 3. What you can change freely, and what you can't

Edit anything in the first column without telling me. Anything in the second
needs the validator re-run, or it will quietly stop working for someone.

| Free — pure taste | Load-bearing — re-validate if changed |
|---|---|
| Surfaces, paper colour, card colour | The **series hues** (§5) |
| Typefaces, sizes, spacing, radii | The **4-line cap** on the chart (§6) |
| Textures, borders, decoration | The rule that colour is never the *only* signal |
| The pastel tints | The `--live` accent staying reserved |
| Avatar parts and shapes | |

Re-running the check, after any change to the series hues:

```bash
node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#4a3aa7" \
  --mode light --surface "#fdfaf5" --pairs all
```

It checks lightness, chroma, red/green colour-blind separation, ordinary-vision
separation, and contrast against the paper. It's a script, not an opinion — if it
fails, the colours genuinely don't work, however nice they look to us.

---

## 4. Surfaces, ink and tints

Current values, live in [src/styles.css](src/styles.css):

| Role | Hex | Use |
|---|---|---|
| Paper | `#fdfaf5` | Page ground |
| Card | `#ffffff` | Raised surfaces |
| Ink | `#33302c` | Body text — warm near-black, never pure `#000` |
| Ink soft | `#7b7369` | Secondary text, labels |
| Line | `#e8e0d4` | Hairline borders, gridlines |

**Tints** (large areas only, never a chart line):

| Name | Hex | Use |
|---|---|---|
| Pink | `#e8a0b0` | Brand accent, the "off" in Bake Off |
| Sage | `#a8bfa0` | Positive states, correct picks |
| Sky | `#9fbdd4` | Neutral highlights |
| Butter | `#f2d9a0` | Current nav item, "this week" |

**Reserved:**

| Name | Hex | Use |
|---|---|---|
| Live | `#d1495b` | **Only** for "the episode is airing" and LATE / VERY LATE flags |

`--live` is reserved on purpose. The moment it also means "player 6" or "delete",
the live indicator stops meaning anything. Give new states a tint, not this.

**No dark mode.** A deliberate choice, not an omission: this is a display for a
lit room, and a second validated palette is real work for a case that doesn't
arise. Revisit only if people start using it in bed.

---

## 5. Player colours

Two different jobs, so two different rules.

### On the chart — four hues, validated

These are the only colours that ever draw a line, in this fixed order:

| Slot | Hue | Hex |
|---|---|---|
| 1 | Blue | `#2a78d6` |
| 2 | Orange | `#eb6834` |
| 3 | Aqua | `#1baf7a` |
| 4 | Violet | `#4a3aa7` |

Verified against our paper surface, all pairs, including simulated protanopia and
deuteranopia. Aqua sits below 3:1 against the paper, which is why chart lines are
**always directly labelled** — that's the mitigation, and it isn't optional.

Adding a fifth breaks it: red against orange measures ΔE 7.1 to ordinary vision,
below the 15 floor. That isn't a near miss, it's two colours most people can't
separate. **Four is the cap**, and §6 is built around it.

### Everywhere else — one colour each, and it never works alone

Each player still gets their own colour for their avatar, their leaderboard row
and their name on the prediction wall. With a dozen-plus players those can't all
be reliably distinguishable — and they don't need to be, because **the colour is
always beside their name and avatar**. It's a memory aid and a bit of fun, not a
carrier of meaning.

The line to hold: **colour never carries information alone, anywhere in this
app.** Correct picks get a tick as well as green. Live gets a label as well as
red. A player's row has their name as well as their colour.

Assign these tints by hand as codes are issued, keeping neighbours in the
leaderboard visibly different. ~16 is comfortable.

---

## 6. The points chart

The centrepiece, and the thing most likely to go wrong. Twelve cumulative lines
in twelve colours is spaghetti — unreadable at any size, and worse on a phone.

So: **most lines are grey, four are not.**

- Every player's line is drawn in `--line-muted` at 1.5px.
- **Highlighted, in the four series hues:** the top three, plus *you* if you're
  logged in. Direct-labelled at the right-hand end.
- **Tap or hover any leaderboard row** to swap that player into a highlight slot.
- Colour follows the *player*, not their rank — when the table reshuffles,
  nobody's line changes colour mid-episode.

Other specs: 2px lines, no markers except the final point, x-axis by episode,
y-axis starting at zero, recessive gridlines in `--line`. On a phone the chart is
the one element allowed to scroll sideways, inside its own container. A
crosshair and tooltip on hover. A plain table view of the same numbers, always
reachable — that's the fallback for anyone the colours fail.

---

## 7. Texture

Used sparingly, and never as a way to distinguish data.

- **Paper grain** — a faint SVG noise overlay on the page ground, ~2% opacity.
  Does most of the "warm paper" work on its own.
- **Scalloped edges** — a piecrust/doily curve on section headers. One decorative
  motif is plenty; this is the one.
- **Stitch borders** — a dashed hairline for provisional things: an unconfirmed
  entry, a voided category.
- **Hatching** — 45° diagonal lines, for voided categories and disallowed
  entries. This one is functional: it means "struck out" and reads without
  colour, including in print.

No photographic textures, no drop shadows deeper than a 1px hairline, no gradients
on data marks.

---

## 8. Components

- **Cards** — white, 1px `--line` border, 14px radius, ~1.15rem padding. The
  default container for everything. No shadows.
- **Pills** — status and flags. Always a dot or icon *and* a word.
- **Avatars** — circular, the player's tint. Assembled SVG later; a coloured
  circle with their initial until then.
- **Nav** — four short uppercase words, letterspaced, current item on `--butter`.
  Must fit one phone line without wrapping; that's what caps it at four.
- **Numbers** — `tabular-nums` in any column that aligns vertically (leaderboard,
  axis ticks). Proportional everywhere else.

---

## 9. Type

| Role | Stack |
|---|---|
| Display — headings, the brand | Georgia / Iowan Old Style / serif |
| Body, UI, numbers | `system-ui` stack |

A warm serif for headings and a plain sans for everything else. The serif is a
placeholder worth replacing — something with more character would lift the whole
thing, and it's the single highest-value change available. Any webfont needs a
real fallback stack, since it's the difference between a slow page and a broken
one.

---

## 10. Motion

Points appear during the episode, so movement is meaningful and should be
noticed — but it's on screen for an hour, so it must never nag.

- Score changes: a 400ms ease of the number and the line extending.
- Leaderboard reorder: a 300ms position transition, never a fade.
- The live indicator: a slow 2s pulse. Nothing else pulses, ever.
- Respect `prefers-reduced-motion` — swap every transition for an instant change.

---

## 11. Open

- The display typeface (§9)
- Whether the tints are hand-assigned or drawn from a fixed 16-colour list
- Avatar part inventory — for your friend: same viewBox, same origin, body fill
  as `currentColor`
- Print stylesheet for the final standings, if you want a physical trophy sheet
