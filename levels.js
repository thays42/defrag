// Level data. Each level has a stable `id` (progress is saved by id) and one primary `mechanic`.
// Board notation: '.' empty, '#' reserved, letters are files, a digit after a letter is a fragment number.
// Sector numbers in homes, fragile and so on are 1-based. Run `node tools/check-levels.js` after editing.
// `intro` levels teach a rule: they hide the score. `beatable` means par is deliberately above the optimum.
const mechanics = [
  {id: 'basics', name: 'Basics', rule: 'Join each file into one unbroken run.'},
  {id: 'homes', name: 'Homes', rule: 'A file with a home must finish entirely inside the sectors marked with its letter.'},
  {id: 'reserved', name: 'Reserved sectors', rule: 'Solid dark sectors are reserved. Nothing can land on them.'},
  {id: 'splitting', name: 'Splitting', rule: 'Tap inside a selected run to move only part of it. A split costs 1 extra point.'},
  {id: 'ordered', name: 'Numbered fragments', rule: 'Fragments are numbered. Finish each file with its numbers in order, lowest on the left. Neighbouring fragments of a file select together, whatever their numbers.'},
  {id: 'clipboard', name: 'Clipboard', rule: 'Select a run, then choose Clipboard to lift it off the disk. Choose Clipboard again, then a destination, to place it back. The clipboard holds one run. Lifting and placing each cost 1. Empty the clipboard to finish.'},
  {id: 'seek', name: 'Seek cost', rule: 'A move costs the number of sectors it travels. Splitting still adds 1. The fewest moves is not always the cheapest route.'},
  {id: 'consolidate', name: 'Free space', rule: 'Finish with every empty sector in one unbroken stretch.'},
  {id: 'system', name: 'System files', rule: 'Locked system files (S) never move. A chip like S→A means A must start in the sector right after S.'},
  {id: 'fragile', name: 'Cracked sectors', rule: 'A cracked sector fails as soon as it is emptied. An empty cracked sector can take one write.'},
  {id: 'links', name: 'Linked files', rule: 'Linked files must finish touching, in the order shown: A→B means A’s run ends right where B’s starts.'},
  {id: 'nudge', name: 'Nudges', rule: 'A normal move needs a gap as long as the run. A nudge shifts a run one sector into a single empty sector beside it, overlapping where it was. Select the arrow sector (← →) beside the selected run. Each nudge costs 1, and the supply is limited.'},
];

const chapters = [
  {
    name: 'Basics',
    levels: [
      {id: 'join-two-blocks', mechanic: 'basics', intro: true, par: 1, name: 'Join two blocks', board: 'A.A', goal: 'Join the two A blocks.', prompt: 'Tap either A, then tap the empty sector.'},
      {id: 'move-a-run', mechanic: 'basics', intro: true, par: 1, name: 'Move a run', board: 'AA..AA', goal: 'Move a pair of A blocks as one run.', prompt: 'Tap either block in a pair to select both.'},
      {id: 'split-a-run', mechanic: 'splitting', intro: true, tutorial: 'split', par: 2, name: 'Split a run', board: 'AA.AA', goal: 'Use the single empty sector to join both pairs.', prompt: 'Tap either pair to select the whole run.'},
      {id: 'find-home', mechanic: 'homes', intro: true, par: 1, name: 'Find home', board: 'AA..', homes: {A: [3, 4]}, goal: 'Move A into the two marked home sectors.', prompt: 'Tap either A to select the run.'},
      {id: 'two-files', mechanic: 'homes', intro: true, par: 2, name: 'Two files', board: 'AB.AB.', homes: {A: [1, 2], B: [5, 6]}, goal: 'Join each file inside its marked home.', prompt: 'Try making room in A’s home first.'},
      {id: 'reserved-intro', mechanic: 'reserved', intro: true, par: 1, name: 'Reserved sectors', board: 'A#A.', goal: 'Join A using the open sector beside it.', prompt: 'The dark sector is reserved. Move the left A into the open sector.'},
      {id: 'scattered-gaps', mechanic: 'reserved', par: 3, name: 'Scattered gaps', board: '###...#B.AB##.##A', homes: {A: [4, 5], B: [10, 11]}, goal: 'Bring two files home using the gaps between reserved sectors.'},
      {id: 'warm-up', mechanic: 'basics', par: 2, name: 'Warm-up', board: '.BBBAA.CAC.C', goal: 'Bring all three files together. Runs can cross a row break.'},
      {id: 'required-split', mechanic: 'splitting', par: 4, name: 'Required split', board: '.BCCCAA.BBAA', goal: 'Find a split that opens enough space to finish.'},
    ],
  },
  {
    name: 'Temporary storage',
    levels: [
      {id: 'borrow-a-home', mechanic: 'homes', intro: true, par: 3, name: 'Borrow a home', board: 'BA.C', homes: {A: [1, 1], B: [2, 2], C: [3, 4]}, goal: 'Send A and B home by borrowing an empty C sector.', prompt: 'Move A into sector 3 to make room for B.'},
      {id: 'park-a-pair', mechanic: 'homes', par: 3, name: 'Park a pair', board: 'BBAA..CC', homes: {A: [1, 2], B: [3, 4], C: [5, 8]}, goal: 'Find a temporary space large enough for a whole pair.'},
      {id: 'choose-what-to-park', mechanic: 'homes', par: 3, name: 'Choose what to park', board: 'BAAB..CC.', homes: {A: [1, 2], B: [3, 4], C: [5, 9]}, goal: 'Choose which file to park in C’s home.'},
      {id: 'make-a-parking-spot', mechanic: 'splitting', par: 5, name: 'Make a parking spot', board: 'BBAA.CC.', homes: {A: [1, 2], B: [3, 4], C: [5, 8]}, goal: 'Make enough room to borrow C’s home and get both other files home.'},
    ],
  },
  {
    name: 'Move order',
    levels: [
      {id: 'save-the-gap', mechanic: 'homes', intro: true, par: 3, name: 'Save the gap', board: '..ABB', homes: {B: [3, 4], A: [5, 5]}, goal: 'Keep the only two-sector gap free for the B pair.', prompt: 'Move the B pair first, then send A home.'},
      {id: 'a-can-wait', mechanic: 'homes', par: 4, name: 'A can wait', board: 'C.BBA.C', homes: {B: [1, 2], C: [3, 4], A: [6, 6]}, goal: 'Choose when to send A home.'},
      {id: 'b-can-wait', mechanic: 'homes', par: 4, name: 'B can wait', board: 'BB.ACC..A', homes: {C: [3, 4], A: [5, 6], B: [7, 8]}, goal: 'Get everyone home while keeping space to join A.'},
      {id: 'required-split-revisited', mechanic: 'splitting', par: 6, name: 'Required split revisited', board: '.BCCCAA.BBAA', homes: {B: [1, 3], C: [6, 8], A: [9, 12]}, goal: 'Revisit a familiar layout with marked homes. Clear a landing spot for B.'},
    ],
  },
  {
    name: 'Strategic splitting',
    levels: [
      {id: 'beat-par', mechanic: 'splitting', beatable: true, par: 5, name: 'Beat par', board: 'AA.AACCBCB.B', goal: 'Par is the best score without splitting. Use a split to beat it.'},
      {id: 'one-sector-off', mechanic: 'splitting', par: 5, name: 'One sector off', board: '..ABBAABBA', homes: {A: [1, 4], B: [7, 10]}, goal: 'Use a split to fit a run into its exact home.'},
      {id: 'two-splits', mechanic: 'splitting', par: 7, name: 'Two splits', board: '..ABBBBAAA', homes: {A: [1, 4], B: [7, 10]}, goal: 'Make room to get both four-block files home.'},
    ],
  },
  {
    name: 'Final challenges',
    levels: [
      {id: 'four-files', mechanic: 'homes', par: 6, name: 'Four files', board: '.BBCAACC.DAD', homes: {A: [1, 3], B: [5, 6], C: [7, 9], D: [11, 12]}, goal: 'Get four files home with only two free sectors.'},
      {id: 'free-the-pair', mechanic: 'homes', par: 6, name: 'Free the pair', board: 'AA.BBDCACD.C', homes: {A: [1, 3], B: [5, 6], C: [7, 9], D: [11, 12]}, goal: 'Clear the occupied homes and find the cheapest way to align B.'},
      {id: 'trade-places', mechanic: 'splitting', par: 7, name: 'Trade places', board: 'CCCA.BBAAB.DDD', homes: {A: [1, 3], B: [5, 7], C: [8, 10], D: [12, 14]}, goal: 'Use two empty sectors to get A, B, and C past one another.'},
      {id: 'tight-fit', mechanic: 'splitting', par: 9, name: 'Tight fit', board: 'A.AAACCC.BBBDD', homes: {A: [1, 4], B: [5, 7], C: [9, 11], D: [13, 14]}, goal: 'Reshape the gaps to move three large files into place.'},
    ],
  },
  {
    name: 'Reserved sectors',
    levels: [
      {id: 'blocked-lanes', mechanic: 'reserved', par: 4, name: 'Blocked lanes', board: 'BA.#..#CBA##C', homes: {A: [1, 2], B: [5, 6], C: [8, 9]}, goal: 'Route the files around the reserved sectors.'},
      {id: 'broken-workspace', mechanic: 'reserved', par: 6, name: 'Broken workspace', board: '##AAA#C.DB.C#.CB##D', homes: {A: [3, 5], B: [7, 8], C: [10, 12], D: [14, 15]}, goal: 'Use the scattered gaps to reunite B, C, and D.'},
      {id: 'across-the-disk', mechanic: 'reserved', par: 7, name: 'Across the disk', board: '###C.A#.DAB###BC#D.B', homes: {A: [4, 5], B: [8, 10], C: [15, 16], D: [18, 19]}, goal: 'Bring four files home around reserved sectors spread across the disk.'},
    ],
  },
  {
    name: 'Two-file challenges',
    levels: [
      {id: 'pocket-change', mechanic: 'reserved', par: 4, name: 'Pocket change', board: '#.BBA###.AB.A##..', homes: {A: [2, 4], B: [11, 13]}, goal: 'Use the small pockets of space to bring both files home.'},
      {id: 'split-workspace', mechanic: 'reserved', par: 6, name: 'Split workspace', board: '##.ABAA#A####BB...#B.', homes: {A: [3, 6], B: [15, 18]}, goal: 'Clear both homes with working space spread across four rows.'},
      {id: 'cut-across', mechanic: 'splitting', par: 6, name: 'Cut across', board: '###########..ABBB#BAAA', homes: {A: [12, 15], B: [19, 22]}, goal: 'Trade the two files between their homes with only two open sectors.'},
    ],
  },
  {
    name: 'Numbered fragments',
    levels: [
      {id: 'in-order', mechanic: 'ordered', intro: true, par: 1, name: 'In order', board: 'A2.A1.', goal: 'Join A with its fragments numbered 1, 2 from left to right.', prompt: 'Select A2 and move it into the sector after A1.'},
      {id: 'shuffled', mechanic: 'ordered', par: 5, name: 'Shuffled', board: 'A1A3B3.B1B2A2', goal: 'Put both files back together in number order.'},
      {id: 'two-decks', mechanic: 'ordered', par: 7, name: 'Two decks', board: 'B1A2B3B2A3A1.', goal: 'Sort two interleaved files with a single free sector.'},
    ],
  },
  {
    name: 'Clipboard',
    levels: [
      {id: 'no-room-at-all', mechanic: 'clipboard', intro: true, clipboard: true, par: 3, name: 'No room at all', board: 'AB', homes: {A: [2, 2], B: [1, 1]}, goal: 'Swap A and B. There are no empty sectors, so use the clipboard.', prompt: 'Select A, then choose Clipboard to lift it off the disk. Then move B, and place A.'},
      {id: 'hold-that-thought', mechanic: 'clipboard', clipboard: true, par: 4, name: 'Hold that thought', board: 'CBBC.AA', homes: {A: [1, 2], B: [5, 6], C: [3, 4]}, goal: 'Send three files home through one free sector and the clipboard.'},
      {id: 'juggle', mechanic: 'clipboard', clipboard: true, par: 5, name: 'Juggle', board: 'CCAAB.B', homes: {A: [4, 5], B: [1, 2], C: [6, 7]}, goal: 'Every file is in the wrong place. Decide what to hold.'},
    ],
  },
  {
    name: 'Seek cost',
    levels: [
      {id: 'short-hops', mechanic: 'seek', intro: true, cost: 'seek', par: 2, name: 'Short hops', board: 'A.AAB.B', goal: 'Join both files. Each move costs the distance it travels.', prompt: 'Each destination shows its cost. Try a long move and watch the score, then undo and find the cheap way.'},
      {id: 'long-way-round', mechanic: 'seek', cost: 'seek', par: 6, name: 'The long way round', board: 'BC.BACA..', homes: {A: [6, 7]}, goal: 'An extra short move can beat one long one.'},
      {id: 'head-travel', mechanic: 'seek', cost: 'seek', par: 10, name: 'Head travel', board: '.ABBC.AC', homes: {A: [3, 4]}, goal: 'Keep the read head’s total travel as low as you can.'},
    ],
  },
  {
    name: 'Free space',
    levels: [
      {id: 'one-gap', mechanic: 'consolidate', intro: true, consolidate: true, par: 1, name: 'One gap', board: 'A.A.', goal: 'Join A and leave the free space in one stretch.', prompt: 'Some moves join A but leave the empty sectors in two pieces.'},
      {id: 'sweep-up', mechanic: 'consolidate', consolidate: true, par: 3, name: 'Sweep up', board: 'B..CCBAA.', goal: 'Join every file and gather the free space.'},
      {id: 'tidy-disk', mechanic: 'consolidate', consolidate: true, par: 6, name: 'Tidy disk', board: 'BA.C.AABB.C', homes: {A: [3, 5]}, goal: 'Send A home and leave one clean stretch of free space.'},
    ],
  },
  {
    name: 'System files',
    levels: [
      {id: 'boot-sector', mechanic: 'system', intro: true, locked: ['S'], links: [['S', 'A']], par: 1, name: 'Boot sector', board: 'A.SS.A', goal: 'The system file S is locked. Join A directly after it.', prompt: 'S cannot move. Move the left A to the far side of S.'},
      {id: 'load-order', mechanic: 'system', locked: ['S'], links: [['S', 'A']], par: 4, name: 'Load order', board: 'AA.SS.ABB', goal: 'Put all of A directly after the system file. S will not budge.'},
      {id: 'kernel-space', mechanic: 'system', locked: ['S'], links: [['S', 'A']], par: 4, name: 'Kernel space', board: 'B.AAASS.BB', goal: 'A sits right in front of S. Get it behind S instead.'},
      {id: 'driver-stack', mechanic: 'system', locked: ['S'], links: [['S', 'A']], par: 5, name: 'Driver stack', board: 'BSSBB.AA.A', goal: 'B is in the way behind S. Clear it out for A.'},
    ],
  },
  {
    name: 'Cracked sectors',
    levels: [
      {id: 'cracked', mechanic: 'fragile', intro: true, fragile: [1, 2], par: 1, name: 'Cracked', board: 'A.AA', goal: 'Join A. Both of the first two sectors are cracked.', prompt: 'Move the lone A into the empty cracked sector. It can take one write. The sector A leaves fails once it is empty.'},
      {id: 'one-write-left', mechanic: 'fragile', fragile: [1, 6, 9], par: 5, name: 'One write left', board: '.ABCC.ABB', homes: {A: [4, 5], B: [1, 3], C: [6, 7]}, goal: 'Three cracked sectors. Use each one only when you must.'},
      {id: 'failing-drive', mechanic: 'fragile', fragile: [4], par: 6, name: 'Failing drive', board: 'AA.A.BB', homes: {A: [5, 7], B: [1, 2]}, goal: 'Swap A and B before the cracked sector fails at the wrong time.'},
    ],
  },
  {
    name: 'Linked files',
    levels: [
      {id: 'chained', mechanic: 'links', intro: true, links: [['A', 'B']], par: 1, name: 'Chained', board: '.BA', goal: 'A must end directly before B.', prompt: 'Move A to the sector in front of B.'},
      {id: 'chain-of-three', mechanic: 'links', links: [['A', 'B'], ['B', 'C']], par: 3, name: 'Chain of three', board: 'BAA.CB.', goal: 'Line up the chain A→B→C.'},
      {id: 'daisy-chain', mechanic: 'links', links: [['A', 'B'], ['B', 'C']], par: 4, name: 'Daisy chain', board: 'ABB.BC.AA', goal: 'Rebuild the chain A→B→C with two free sectors.'},
    ],
  },
  {
    name: 'Nudges',
    levels: [
      {id: 'nudge', mechanic: 'nudge', intro: true, nudges: 1, par: 1, name: 'Nudge', board: 'AA.', homes: {A: [2, 3]}, goal: 'Slide A one sector right into its home.', prompt: 'There is no two-sector gap for A. Select A, then choose the → sector.'},
      {id: 'scoot-over', mechanic: 'nudge', nudges: 2, par: 3, name: 'Scoot over', board: 'BAA.BC', homes: {A: [4, 5], B: [1, 2], C: [6, 6]}, goal: 'Two nudges, one free sector. Get all three files home.'},
      {id: 'shuffle-step', mechanic: 'nudge', nudges: 2, par: 7, name: 'Shuffle step', board: 'C.AACBBB', homes: {A: [1, 2], B: [4, 6], C: [7, 8]}, goal: 'Spend your two nudges where a normal move cannot go.'},
    ],
  },
];

if (typeof module !== 'undefined') module.exports = {mechanics, chapters};
