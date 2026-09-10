# Art for Fantasy Bake Off

A brief for Nat. The app is a Bake Off prediction game for about a dozen of us —
everyone picks who'll get Star Baker, who's going home, and so on, and the scores
move live while the episode airs.

**The numbers below are a minimum, not a target.** More is genuinely better, and
anything more detailed or more characterful than the bare spec is welcome. The
only things that are fixed are the canvas and the face box, because the pieces
get stacked on top of each other by code.

**Open `TEMPLATE.svg` (in `src/avatar/`) in a browser first.** It draws the
canvas, the face box and a worked example at real sizes. It'll explain the rest
of this page in about ten seconds.

---

## 1. The avatar parts — the main job

Every player builds a little character out of three pieces: **a treat, a pair of
eyes, a mouth**. They pick one of each, so any treat has to work with any eyes
and any mouth.

The minimum:

- **5 treats**
- **a second colourway for a few of them** — how many, and which, is your call.
  Some shapes take a recolour better than others
- **4 sets of eyes**
- **4 mouths or moustaches**

### Three rules that make them stack

**1. Same canvas every time — 48 × 48 — and don't crop.** The three pieces get
laid on top of each other, so the empty space around your drawing is what keeps
everything lined up. A trimmed file lands in the wrong place.

**2. Keep the face box clear.** The treat's body should fill it, flat and
light-coloured. Eyes and mouths go inside it and nowhere else. Icing, cherries,
sprinkles and so on go above it. (A moustache creeping up into the eye area is
fine — the box as a whole is the boundary, not the line across the middle.)

**3. Eyes and mouths in one dark colour** — `#3d2b33` — and nothing else. They
have to read on every treat.

### Silhouettes matter more than detail

In the leaderboard these are **24 pixels across**. At that size the outline is
all you get. So the five treats want to be different *shapes*, not five round
things with different icing on top — say a tall cupcake, a ring doughnut, a flat
biscuit, a triangular slice, a long eclair.

Above that size the detail absolutely shows, and the big version in the builder
is 120px, so do go to town. Just make sure the outline on its own still tells
them apart.

**Keep outlines fairly chunky.** Thin lines vanish at thumbnail size.

### The circle behind

Every player has their own colour, and it sits behind their treat as a pale
tinted circle. There are about sixteen of these, so at some point a treat will
land on a tint close to its own colour — **a dark outline round the treat is what
stops it dissolving**, and it's the one bit of the look that isn't optional.

Anything outside the circle in the template gets cut off by the frame.

### Files

One file per piece, named like this:

```
treat-cupcake.svg          eyes-sleepy.svg        mouth-grin.svg
treat-cupcake-chocolate.svg
```

A folder or a zip is perfect. Don't worry about tidying the files up — that end
is handled.

---

## 2. The favicon

The tiny icon in the browser tab.

**Make it one of your five treats** — the same drawing, not a new one. Then the
tab and the avatars obviously belong to each other, which is most of what a
favicon is for.

Draw it once at 48 × 48 and we'll generate the half-dozen sizes browsers want
from that.

Two constraints:

- **It has to work at 16 pixels.** One bold shape, a colour or two, no text.
- **The iPhone home-screen version can't be transparent** — iOS fills
  transparency with black. Give it a solid background: white, or the pale pink
  below.

---

## 3. If you fancy it — the title

"FANTASY BAKE OFF" sits at the top of every page and is currently just bold text.
A drawn version would lift the whole thing. Vector, so it can scale down to a
phone.

Entirely optional, and last in the queue.

---

## Please don't draw these

They're already built in code, and a drawn version would only drift out of sync:

- the scalloped icing strips along the top of panels
- the faint paper texture
- the diagonal stripes on struck-out entries
- buttons, panels, and the white ring around the avatars
- the points chart

---

## Format and colours

**Vector — SVG.** Illustrator, Inkscape, Figma and Affinity all export it. Not
PNG or JPG: the same drawing has to be sharp at 24 pixels and at 120.

**Flat colour.** No gradients, no drop shadows, no soft edges, no textures. The
whole app is flat and slightly plasticky — think 2010 cake games, Papa's
Cupcakeria, Purble Place — and a soft-shaded drawing would look pasted in from
somewhere else.

**Outlines in `#3d2b33`**, a warm near-black. Not pure black; nothing in the app
is pure black.

The palette everything sits on, if it's useful:

| | |
|---|---|
| Pale pink — the page | `#fbebf1` |
| Icing pink | `#f7c9da` |
| White — panels | `#ffffff` |
| Ink — outlines and text | `#3d2b33` |
| Bright pink | `#e8709c` |
| Deep pink — buttons | `#b23a66` |
| Mint | `#7fd1b9` |
| Butter yellow | `#ffd98e` |

You're not restricted to these — treats should look like food, not like the UI.
It's a guide to what they'll be sitting next to.
