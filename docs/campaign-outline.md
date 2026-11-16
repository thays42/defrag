---
title: Defrag campaign outline
created: 2026-11-15
source: claude-code
type: spec
status: draft
tags: [campaign, level-design, tutorial, defrag]
---

# Defrag campaign outline

## What the campaign does today

**Status:** Phases 1–5 are done. The list below describes the campaign before them.

The campaign had 55 levels in 15 chapters. It had these problems.

- **Chapter 1 is overloaded.** It teaches basics, splitting, homes, and reserved sectors in 9 levels. A new player meets four rules before finishing one chapter.
- **Row wrap is never taught.** "Warm-up" is the first board with more than one row. Only a small icon shows that the end of a row joins the start of the next. The goal sentence that mentioned it is now hidden.
- **"Final challenges" is chapter 5 of 15.** Ten more chapters follow, so the name is false.
- **Later mechanics are silos.** From "Numbered fragments" on, each chapter is an intro and two levels. No mechanic returns or combines with another. The campaign has no finale.
- **Some levels do not test their mechanic.** In `scattered-gaps`, `blocked-lanes`, and `pocket-change`, the reserved sectors do not change the optimum. They are decoration.
- **Two orders exist.** The campaign orders by chapter. The level catalog orders by mechanic, then par. A player sees two different "next" levels.
- **The board changes size.** Boards range from 1 to 4 rows. The layout jumps between levels.

## Principle 1: a fixed disk

The board is always 6 columns by 4 rows (24 sectors). Every current level fits, since the largest is 24 sectors.

A level uses one **partition**: a contiguous range of those 24 sectors. Sectors outside the partition are **unallocated**. They are not part of the puzzle. They render as a faint outline, not as reserved sectors.

Rules for placing a partition:

- One-row puzzles sit in row 2, centered horizontally.
- Two-row puzzles sit in rows 2–3.
- Three-row puzzles sit in rows 1–3 or 2–4.
- Multi-row puzzles always use all 6 columns, so the wrap rule never changes.

Because a partition is contiguous, unallocated sectors only sit at its two ends. They never sit between two partition sectors. This keeps seek cost, wrap, and free-space rules unchanged. The engine needs one new cell type (unallocated) that is never a destination and never counts as free space.

The frame also gives a permanent place to draw the **read path**. A track in the board's gutter runs from the end of each row to the start of the next. This shows wrap as part of the disk, not as a per-run icon. The track also separates the rows visually. Decided: keep it.

**Strongest objection.** A 3-sector intro inside a 24-sector frame can look lost. A new player may also try to tap the unallocated sectors. Mitigations: keep unallocated sectors very faint, make them inert with no hover state, and animate the partition on each level change, as a reveal.

## Principle 2: one new idea per chapter

Each chapter follows four beats.

| Beat | Purpose | Partition | Design target |
| --- | --- | --- | --- |
| Teach | Show the rule with one forced move. | 1 row | One solution. Prompt on screen. |
| Practice | Use the rule with no trap. | 1–2 rows | Trap rate low. |
| Twist | The obvious move fails. | 2–3 rows | Trap rate high. Lines 1–4. |
| Combine | The rule meets an earlier rule. | Full disk | Two mechanics both change par. |

The Teach level is also the rest beat after the previous chapter's hardest level.

## Principle 3: how difficulty rises

Board size does not make a level harder. These levers do, roughly from mild to strong.

- **More files.** More things to track.
- **Less free space.** Fewer free sectors per file means fewer legal moves and more parking.
- **Move-order dependency.** One file must move before another can.
- **Required splits.** The player must break a run they just joined.
- **Traps.** Tempting first moves that make par impossible.
- **Few solutions.** Lines 1–4. Many lines feel like shuffling.
- **Combined mechanics.** Two rules that pull against each other.

Within a chapter, raise one lever per level. Across chapters, raise the floor. A Combine level should be harder than any earlier Twist.

## The campaign

Mechanic order follows dependencies. A rule comes after every rule it builds on. End-state rules come before hardware rules. New tools come late, because they widen the solution space and make earlier puzzles trivial. Seek comes last because it changes what the score means.

The story is the life of one disk, from format to first boot. It is a light frame. Chapter titles carry it. No dialogue is needed.

### Chapter 1: Format

New disk. Learn to move data.

| Beat | Level | Teaches |
| --- | --- | --- |
| Teach | `join-two-blocks` | Select, then place. |
| Teach | `move-a-run` | Neighbouring blocks move as one run. |
| Teach | **New: across the break** | Partition is sectors 10–15, crossing rows 2 and 3. A run must cross the row break. |
| Teach | `reserved-intro` | Reserved sectors block landing. |
| Teach | **New: par** | The obvious solution costs 3. Par is 2. Teaches score, par, and undo. |
| Twist | `warm-up` | Three files, a row break, and reserved sectors. |

### Chapter 2: Allocation

Files have homes.

| Beat | Level |
| --- | --- |
| Teach | `find-home`, `two-files` |
| Practice | `borrow-a-home`, `park-a-pair` |
| Twist | `choose-what-to-park`, `save-the-gap` |
| Combine | `scattered-gaps` (reworked in phase 2 as `scattered-gaps-ii`, par 4; board reworked again in phase 3 so its homes change par) |

### Chapter 3: Move order

Same rule, harder planning. Could merge into chapter 2.

| Beat | Level |
| --- | --- |
| Practice | `a-can-wait`, `b-can-wait` |
| Combine | `blocked-lanes` (rework so reserved sectors change par) |

### Chapter 4: Fragmentation

Splitting.

| Beat | Level |
| --- | --- |
| Teach | `split-a-run` |
| Practice | `required-split` |
| Twist | `make-a-parking-spot`, `one-sector-off` |
| Twist | `beat-par` (par is beatable, so it teaches that par is not a ceiling) |
| Combine | `required-split-revisited`, `two-splits` |

### Chapter 5: Full disk

First chapter on all 24 sectors. A test of chapters 1–4, with no new rule. Pick five or six of the current hard levels. Move the rest to an optional "Extra" set.

Candidates: `four-files`, `free-the-pair`, `trade-places`, `tight-fit`, `broken-workspace`, `across-the-disk`, `split-workspace`, `cut-across`. Cut or rework `pocket-change`.

Chosen in phase 2: `four-files`, `free-the-pair`, `cut-across`, `split-workspace`, `across-the-disk`, `tight-fit`. Extra holds `trade-places`, `broken-workspace` and the reworked `pocket-change`.

### Chapter 6: File system rules

Three rules that change what "done" means. Each gets a Teach, a Twist, and a Combine level.

| Rule | Teach | Twist | Combine gap |
| --- | --- | --- | --- |
| Numbered fragments | `in-order` | `shuffled`, `two-decks` | `filed-in-order` (with homes). |
| Free space | `one-gap` | `sweep-up`, `tidy-disk` | `tidy-disk` (with homes). |
| Linked files | `chained` | `chain-of-three`, `daisy-chain` | `broken-chain` (with splits). |

This chapter is large, but it stays one chapter for now.

### Chapter 7: Install

The operating system arrives. System files are locked and linked, so this follows linked files.

| Beat | Level |
| --- | --- |
| Teach | `boot-sector` |
| Twist | `load-order`, `kernel-space`, `driver-stack` |
| Combine | `install-path`: system files with homes. |

### Chapter 8: Wear

The disk ages. Cracked sectors.

| Beat | Level |
| --- | --- |
| Teach | `cracked` |
| Twist | `one-write-left`, `failing-drive` |
| Combine | `last-writes`: cracked sectors with free space. |

### Chapter 9: Recovery tools

The disk is failing. Two tools help. Both are verbs, so they come after the constraints that make them necessary.

| Tool | Teach | Twist | Combine gap |
| --- | --- | --- | --- |
| Clipboard | `no-room-at-all` | `hold-that-thought`, `juggle` | `fragile-hold` (with cracked sectors and homes). |
| Nudges | `nudge` | `scoot-over`, `shuffle-step` | `tight-quarters` (with reserved sectors and homes). |

### Chapter 10: Seek

The read head is slow. A move costs its distance. This changes what a good score is, so it comes after the player has a firm model of "fewest moves".

| Beat | Level |
| --- | --- |
| Teach | `short-hops` |
| Twist | `long-way-round`, `head-travel` |
| Combine | `long-commute`: seek with homes. |

### Chapter 11: Boot

Finale. Five new levels on the full disk. Each combines three or more earlier rules. The last level uses the system file as the boot target and gives the story its end.

| Level | Rules | Par |
| --- | --- | --- |
| `power-on` | numbered fragments, homes, splitting | 8 |
| `self-test` | linked files, splitting, free space | 7 |
| `mount` | cracked sectors, clipboard, homes | 8 |
| `load-drivers` | seek, homes, splitting | 14 (seek) |
| `first-boot` | system file, numbered fragments, homes | 8 |

The planned sets for `power-on` and `load-drivers` used reserved sectors. The searches tried found no board where they change par, so each swapped in splitting. Every campaign level keeps its hint search under 2e5 states, at the start and one move in.

## What a first-time player gets confused by

| Confusion | Where | Fix |
| --- | --- | --- |
| Tap order: select, then destination. | Level 1 | The prompt already covers it. Keep the destination marks loud. |
| What a "run" is. | Level 2 | Define on first use. Use "run" only. |
| The end of a row joins the next row. | First multi-row board | Dedicated Teach level and a permanent read-path track. |
| Lower score is better. | First score | The new par level. Say "fewer is better" once. |
| What "par" means. | First results sheet | Define as "the best possible score" on first view. Note when par is beatable. |
| Why a joined file is not done. | Homes | Settled state must look different from joined. |
| Tapping a selected run splits it. | Splitting | Already prompted. Show the split cost before the tap commits. |
| Unallocated vs. reserved sectors. | Every small partition | Different visual weight. Unallocated is an outline. Reserved is solid. |
| Numbers on empty sectors mean cost. | Seek | Teach level prompt. Only seek levels show numbers. |
| Clipboard takes two taps to place. | Clipboard | Show clipboard contents beside the board at all times while full. Done before phase 4; phase 4 names the two-tap place in the status line and colors a full clipboard. |
| Hints cost stars. | First hint | State it before the first hint, not after. |
| The catalog's next level differs from Continue. | Menu | Order the catalog by campaign order. |

## Work this implies

- Engine: an unallocated cell type and a partition offset per level.
- UI: a fixed 6×4 frame, a read-path track, and a partition reveal at chapter starts.
- Levels: about 2 new Teach levels, about 7 new Combine levels, and 5 finale levels.
- Tools: generator presets for mechanic pairs, and a checker rule that each Combine level's mechanics all change par.
- Rework or cut the three levels where reserved sectors are decoration.

## Implementation roadmap

Each phase is its own plan and ships working software. Later phases depend on earlier ones.

| Phase | Delivers | Depends on | Plan |
| --- | --- | --- | --- |
| 1. Fixed disk | 6×4 frame, unallocated sectors, read-path track, `offset` level field. | — | `docs/superpowers/plans/2026-11-15-fixed-disk.md` |
| 2. Campaign order | New chapter layout, catalog in campaign order, the two new Teach levels, rework of the three decoration levels, Extra set. | 1 (the row-break level needs `offset`) | `docs/superpowers/plans/2026-11-15-campaign-order.md` |
| 3. Combine levels | Generator presets for mechanic pairs, checker rule that every Combine mechanic changes par, about 7 Combine levels, 5 finale levels. | 2 | `docs/superpowers/plans/2026-11-15-combine-levels.md` |
| 4. First-time player fixes | The confusion table: par and score copy, hint warning, settled state, split cost preview, clipboard contents. | — | `docs/superpowers/plans/2026-11-15-first-time-player.md` |
| 5. Partition reveal | Animation on every level change where the partition moves or resizes. | 1, 2 | `docs/superpowers/plans/2026-11-16-partition-reveal.md` |

## Decisions

- The story is nice to have, not a priority.
- Chapter 6 stays one chapter for now.
- Levels cut from chapter 5 go to an Extra set (tentative).
- Keep the read-path track.
- The partition reveal is plain layout, on every level change, not diegetic.
