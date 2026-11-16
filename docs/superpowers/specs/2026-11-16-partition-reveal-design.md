---
title: Partition reveal design
created: 2026-11-16
source: claude-code
type: spec
status: draft
tags: [defrag, animation, partition, campaign]
---

# Partition reveal design

## Intent

A small level inside the fixed 24-slot frame can look lost. A new player may also tap the unallocated slots. A short animation on each level change shows the partition resize on the same disk. The player sees where the puzzle sits and that the outlines are not play space.

## Finding that changed the scope

The roadmap said "animate the partition growing at a chapter start." The level data does not support that. Each chapter ends near the full disk and its Teach level starts at 3–6 sectors, so a chapter start shrinks the partition. Sizes also go up and down inside chapters. The user chose to animate every level change instead.

## Goals

- Animate every change of partition position or size between two levels, growing or shrinking.
- Keep it short: about 300 ms in total.
- Answer the outline's open question: plain layout, not diegetic. No "disk comes online" story beat.

## Non-goals

- No animation on Retry, Undo, or reopening the same level. The slot set does not change, so nothing plays.
- No animation on the first board after page load. There is no previous partition.
- No change to levels, engine, scoring, or saves.

## Anti-goals

- The animation must never block input or delay the player's first tap.
- It must never leave a slot half-styled if the player leaves mid-animation or resizes the window.

## Approaches

- **A. Slot flip, staggered along the read path (chosen).** Remember the old inside slots before the rebuild. After the rebuild, mark slots that joined or left. Joined slots grow from an outline into a sector. Left slots fade from a sector look to an outline. A per-slot delay in read-path order, moving outward from the old partition, makes the edge seem to travel. CSS keyframes plus about 20 lines of JS. Matches the existing clear sweep and results sheet.
- **B. Track pulse.** The live read-path line extends or retracts and slots flip as it passes. It ties the reveal to the read path, but the track is an SVG redrawn on resize, so syncing is fiddly. About three times the code of A. It can be added on top of A later.
- **C. Morphing outline.** One border around the partition morphs its edges. Partitions are not rectangles (warm-up is 17 sectors), so the border is a changing polygon. Dropped.

## Design

- `buildBoard()` records the previous frame's inside-slot range before replacing the board. A module variable holds it across levels. It is empty on first load.
- After the rebuild, each slot whose inside or outside status changed gets a class, `joining` or `leaving`, and a `--delay` CSS variable.
- The delay comes from the slot's read-path distance to the nearest old-partition edge, scaled so the last slot starts by about 200 ms. Each slot animates for about 120 ms.
- A joining slot is a normal sector button from the start. Its tile content animates in from the dashed-outline look. It is clickable throughout.
- A leaving slot is a normal `.void` from the start. A short keyframe fades a sector-like fill out to the outline.
- Slots that stayed inside get no class. They show the new level's tiles at once.
- `prefers-reduced-motion: reduce` removes the animation. The end state is the base style, so removing keyframes is enough.
- The classes are removed on `animationend`, or are left in place as harmless because each rebuild creates new nodes.

## Left to the builder

- Exact keyframes, easing, and the stagger scale, within the 300 ms budget.
- How the test checks the classes and delay order. Playwright can read classes right after Next, before the animation ends.
