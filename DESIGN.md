# Fantasy Bake Off — Design Guidelines

*Draft v0.2 — the 2010 cake-game direction. §3 marks which parts are taste and
which are load-bearing.*

---

## 1. The idea

**A 2010 cake game.** Papa's Cupcakeria, Bakery Story, Cake Mania, Purble Place.
Pink ground, white panels, thick rounded type, scalloped icing, candy buttons,
chunky white rings around avatars.

Two rules keep it from tipping into pastiche:

- **No gradients, bevels or deep shadows.** The era comes from *shape, colour
  and weight* — which stay crisp on a phone in a way surface effects don't, and
  don't fight a leaderboard.
- **One decorative motif, used sparingly.** The scalloped icing band is it.

**Mobile first.** Most people are on a phone on the sofa. Big screens get more
room, not a different design.

---

## 2. The rule that shapes everything

> **The frame is a cake game. The data is a scoreboard.**

Almost nothing sits directly on the pink. Content lives on white panels, and the
pink is the decorated ground they float on — which is how those games were laid
out anyway: the playfield is clean, the frame is fun.

This isn't only taste. Contrast is measured against whatever a mark actually sits
on, so putting the chart on white is what keeps the palette in §5 valid and stops
players' pink-ish identity colours dissolving into a pink page.

The colour layer follows from it:

| Layer | Where | Character |
|-------|-------|-----------|
| **Ground & tints** | page, icing bands, washes | Soft, low-chroma, large areas |
| **Series hues** | chart lines, chips, dots — anything small that must be told apart | Saturated, small areas, validated |

A player's avatar is a lightened variant of their series hue, computed in CSS —
one stored value, two appearances (TECH_PLAN §7).

---

## 3. What you can change freely, and what you can't

| Free — pure taste | Load-bearing — re-validate if changed |
|---|---|
| Ground pink, icing pink, panel colour | The **series hues** (§5) |
| Typefaces, sizes, spacing, radii | Data sitting on **white**, not on pink |
| Scallop size, texture, decoration | Colour never being the *only* signal |
| Accent and tint colours | `--live` and `--btn` staying reserved |
| Avatar parts and shapes | |

Re-running the check, after any change to the series hues **or to the surface
they sit on**:

```bash
node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#4a3aa7" \
  --mode light --surface "#ffffff" --pairs all
```

It checks lightness, chroma, red/green colour-blind separation, ordinary-vision
separation, and contrast. It's a script, not an opinion — if it fails, the
colours genuinely don't work, however nice they look.

**Owed:** a proper pass on the *identity* palette (§5) once we know the player
count. The four series hues are validated; the wider set isn't yet.

---

## 4. Colour

Live in [src/styles.css](src/styles.css).

**Ground and panels**

| Role | Hex | Use |
|---|---|---|
| Pink ground | `#fbebf1` | The page. Deliberately pale — a full-strength pastel across a whole phone screen is a lot of pink. |
| Icing | `#f7c9da` | Scalloped section headers |
| Panel | `#ffffff` | Everything readable |

**Ink** — warm, never pure black.

| Role | Hex |
|---|---|
| Ink | `#3d2b33` |
| Ink soft | `#8a7078` |
| Line | `#f0dde4` |

**Accents**

| Role | Hex | Use |
|---|---|---|
| Accent | `#e8709c` | Decorative pink. **Not** for white text — too light. |
| Button | `#b23a66` | Interactive fill. Carries white text at 5.7:1. |
| Button edge | `#8e2b50` | The hard bottom edge |
| Mint | `#7fd1b9` | Correct picks |
| Butter | `#ffd98e` | "This week", highlights |
| **Live** | `#e4405f` | **Reserved** — "the episode is airing", and LATE / VERY LATE |

`--live` is reserved on purpose. The moment it also means "player 6" or "delete",
the live indicator stops meaning anything.

**No dark mode.** Deliberate, not an omission: a display for a lit room, and a
second validated palette is real work for a case that doesn't arise.

---

## 5. Player colours

### The four that draw lines

| Slot | Hue | Hex |
|---|---|---|
| 1 | Blue | `#2a78d6` |
| 2 | Orange | `#eb6834` |
| 3 | Aqua | `#1baf7a` |
| 4 | Violet | `#4a3aa7` |

Validated all-pairs against the white panel, including simulated protanopia and
deuteranopia. Aqua sits at 2.82:1 against white, which is why chart lines are
**always directly labelled** — that's the mitigation, and it isn't optional.

A fifth breaks it: red against orange measures ΔE 7.1 to *ordinary* vision,
against a floor of 15. Not a near miss — two colours most people can't separate.

### Everyone else

Every player still gets their own colour, for their avatar, their leaderboard
row, their name on the prediction wall, and their line on the chart. Past four
those can't all be reliably told apart by colour alone — and they don't need to
be, because **the colour is always beside their name and avatar**. It's identity
and a memory aid, not something you have to decode.

The line to hold: **colour never carries information alone, anywhere.** Correct
picks get a tick as well as green. Live gets a label as well as red. A chart line
gets a direct label as well as a hue.

Assign by hand as codes are issued, keeping leaderboard neighbours visibly
different. ~16 is comfortable.

---

## 6. The points chart

*Sketched — expected to change once we can see real data in it.*

Every player has a coloured line. The reader controls how many are shouting at
once, via **three states per line**:

| State | Look | Meaning |
|---|---|---|
| **Full** | Their hue, 2.5px, direct-labelled | Following this one |
| **Muted** | Same hue at ~25%, 1.5px | Context — the shape of the pack |
| **Hidden** | Not drawn | Out of the way |

Tap a player's leaderboard row or legend chip to cycle. Default: everyone
**muted**, with the top three and *you* at **full**.

Two things this shape depends on:

- **Colour follows the player, not their rank.** When the table reshuffles
  mid-episode, nobody's line changes colour.
- **Direct labels and a hover tooltip are mandatory, not decoration.** With a
  dozen coloured lines available, hue alone can't identify anyone — the label is
  what actually does it. Muted lines don't need to be distinguishable from each
  other; they're texture, and that's fine.

Other specs: y-axis from zero, x-axis by episode, recessive gridlines, no markers
except the final point, crosshair on hover. On a phone the chart is the one
element allowed to scroll sideways, inside its own container. A plain table of
the same numbers is always reachable — the fallback for anyone the colours fail.

---

## 7. Texture

- **Scalloped icing** — the signature. A coloured section header whose *lower*
  edge is a row of semicircles, like icing over the top of a panel. Pure CSS
  (`radial-gradient`, `repeat-x`), no images. Headers only, never all four edges
  of every card.
- **Paper grain** — a faint SVG noise overlay on the pink, ~2% opacity. *Not yet
  implemented.*
- **Hatching** — 45° diagonal lines for voided categories and disallowed
  entries. Functional, not decorative: it reads as struck out without colour,
  including in print. (`.hatched`)
- **Stitch borders** — a dashed hairline for provisional things: an unconfirmed
  entry, a pending result.

No photographic textures, no gradients on data marks, no shadow deeper than the
button's 3px edge.

---

## 8. Components

- **Panel** — white, 20px radius, no border, no shadow. The default container;
  optional icing head. See [src/components/Panel.jsx](src/components/Panel.jsx).
- **Candy button** — solid `--btn`, pill, white bold text, 3px `--btn-edge`
  underneath. Presses down 3px on `:active` and the edge collapses. That press is
  the whole 2010 feel, from two properties and no gradient.
- **Avatar** — circular, 3px white ring, thin outer hairline. The ring is of the
  era and genuinely useful: it lifts a soft colour off a soft ground.
- **Pill** — status and flags. Always a dot *and* a word.
- **Nav** — four short uppercase words, current one on white. Must fit one phone
  line without wrapping; that's what caps it at four.
- **Numbers** — `tabular-nums` in any column that aligns vertically.

---

## 9. Type

**Nunito**, from Google Fonts, variable 400–1000.

| Role | Weight |
|---|---|
| Masthead | 1000 |
| Headings | 900 |
| Buttons, nav, labels | 800 |
| Body | 400 |

Superchunky titles against thin body text — that weight contrast is doing most of
the era's work, and it's free.

**A display face for headings is still open**, and it must be freely licensable —
so Google Fonts or an open licence, not a commercial foundry. Nunito 900 carries
it for now; something chunkier (Baloo 2 and Fredoka are the obvious candidates)
would lift the masthead and the big scores. Nunito stays the body face either
way, so swapping one in later touches only headings.

Any webfont needs a real fallback stack — it's the difference between a slow page
and a broken one.

---

## 10. Motion

Points appear during the episode, so movement is meaningful — but it's on screen
for an hour, so it must never nag.

- Score changes: 400ms with a slight overshoot (`cubic-bezier(.34,1.56,.64,1)`).
  Very 2010, and here it's earned — this is the moment worth animating.
- Leaderboard reorder: 300ms position transition, never a fade.
- Button press: 120ms down, no bounce back.
- Live indicator: a slow 2s pulse. Nothing else pulses, ever.
- `prefers-reduced-motion` kills all of it. Already wired up in `styles.css`.

---

## 11. Open

- Display face for headings (§9)
- Identity palette for ~16 players, once we know the count (§3)
- Paper grain overlay (§7)
- Avatar part inventory — for your friend: same viewBox, same origin, body fill
  as `currentColor`
- Print stylesheet for the final standings
