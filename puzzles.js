const chapters = [
  {
    name: 'Basics',
    levels: [
      {name:'Join two blocks', board:'A.A', goal:'Join the two A blocks.', prompt:'Tap either A, then tap the empty sector.'},
      {name:'Move a run', board:'AA..AA', goal:'Move a pair of A blocks as one run.', prompt:'Tap either block in a pair to select both.'},
      {name:'Split a run', board:'AA.AA', goal:'Use the single empty sector to join both pairs.', prompt:'Tap either pair to select the whole run.'},
      {name:'Find home', board:'AA..', homes:{A:[3,4]}, goal:'Move A into the two marked home sectors.', prompt:'Tap either A to select the run.'},
      {name:'Two files', board:'AB.AB.', homes:{A:[1,2],B:[5,6]}, goal:'Join each file inside its marked home.', prompt:'Try making room in A’s home first.'},
      {name:'Reserved sectors', board:'A#A.', goal:'Join A using the open sector beside it.', prompt:'The solid gray sector is reserved. Move the left A into the open sector.'},
      {name:'Scattered gaps', board:'###...#B.AB##.##A', homes:{A:[4,5],B:[10,11]}, par:3, goal:'Bring two files home using the gaps between reserved sectors.'},
      {name:'Warm-up', board:'.BBBAA.CAC.C', par:2, goal:'Bring all three files together. Runs can cross a row break.'},
      {name:'Required split', board:'.BCCCAA.BBAA', par:4, goal:'Find a split that opens enough space to finish.'},
    ],
  },
  {
    name: 'Temporary storage',
    levels: [
      {name:'Borrow a home', board:'BA.C', homes:{A:[1,1],B:[2,2],C:[3,4]}, goal:'Send A and B home by borrowing an empty C sector.', prompt:'Move A into sector 3 to make room for B.'},
      {name:'Park a pair', board:'BBAA..CC', homes:{A:[1,2],B:[3,4],C:[5,8]}, par:3, goal:'Find a temporary space large enough for a whole pair.'},
      {name:'Choose what to park', board:'BAAB..CC.', homes:{A:[1,2],B:[3,4],C:[5,9]}, par:3, goal:'Choose which file to park in C’s home.'},
      {name:'Make a parking spot', board:'BBAA.CC.', homes:{A:[1,2],B:[3,4],C:[5,8]}, par:5, goal:'Make enough room to borrow C’s home and get both other files home.'},
    ],
  },
  {
    name: 'Move order',
    levels: [
      {name:'Save the gap', board:'..ABB', homes:{B:[3,4],A:[5,5]}, goal:'Keep the only two-sector gap free for the B pair.', prompt:'Move the B pair first, then send A home.'},
      {name:'A can wait', board:'C.BBA.C', homes:{B:[1,2],C:[3,4],A:[6,6]}, par:4, goal:'Choose when to send A home.'},
      {name:'B can wait', board:'BB.ACC..A', homes:{C:[3,4],A:[5,6],B:[7,8]}, par:4, goal:'Get everyone home while keeping space to join A.'},
      {name:'Required split revisited', board:'.BCCCAA.BBAA', homes:{B:[1,3],C:[6,8],A:[9,12]}, par:6, goal:'Revisit a familiar layout with marked homes. Clear a landing spot for B.'},
    ],
  },
  {
    name: 'Strategic splitting',
    levels: [
      {name:'Beat par', board:'AA.AACCBCB.B', par:5, goal:'Use a split to beat the best whole-run score.'},
      {name:'One sector off', board:'..ABBAABBA', homes:{A:[1,4],B:[7,10]}, par:5, goal:'Use a split to fit a run into its exact home.'},
      {name:'Two splits', board:'..ABBBBAAA', homes:{A:[1,4],B:[7,10]}, par:7, goal:'Make room to get both four-block files home.'},
    ],
  },
  {
    name: 'Final challenges',
    levels: [
      {name:'Four files', board:'.BBCAACC.DAD', homes:{A:[1,3],B:[5,6],C:[7,9],D:[11,12]}, par:6, goal:'Get four files home with only two free sectors.'},
      {name:'Free the pair', board:'AA.BBDCACD.C', homes:{A:[1,3],B:[5,6],C:[7,9],D:[11,12]}, par:6, goal:'Clear the occupied homes and find the cheapest way to align B.'},
      {name:'Trade places', board:'CCCA.BBAAB.DDD', homes:{A:[1,3],B:[5,7],C:[8,10],D:[12,14]}, par:7, goal:'Use two empty sectors to get A, B, and C past one another.'},
      {name:'Tight fit', board:'A.AAACCC.BBBDD', homes:{A:[1,4],B:[5,7],C:[9,11],D:[13,14]}, par:9, goal:'Reshape the gaps to move three large files into place.'},
    ],
  },
  {
    name: 'Reserved sectors',
    levels: [
      {name:'Blocked lanes', board:'BA.#..#CBA##C', homes:{A:[1,2],B:[5,6],C:[8,9]}, par:4, goal:'Route the files around the reserved sectors.'},
      {name:'Broken workspace', board:'##AAA#C.DB.C#.CB##D', homes:{A:[3,5],B:[7,8],C:[10,12],D:[14,15]}, par:6, goal:'Use the scattered gaps to reunite B, C, and D.'},
      {name:'Across the disk', board:'###C.A#.DAB###BC#D.B', homes:{A:[4,5],B:[8,10],C:[15,16],D:[18,19]}, par:7, goal:'Bring four files home around reserved sectors spread across the disk.'},
    ],
  },
  {
    name: 'Two-file challenges',
    levels: [
      {name:'Pocket change', board:'#.BBA###.AB.A##..', homes:{A:[2,4],B:[11,13]}, par:4, goal:'Use the small pockets of space to bring both files home.'},
      {name:'Split workspace', board:'##.ABAA#A####BB...#B.', homes:{A:[3,6],B:[15,18]}, par:6, goal:'Clear both homes with working space spread across four rows.'},
      {name:'Cut across', board:'###########..ABBB#BAAA', homes:{A:[12,15],B:[19,22]}, par:6, goal:'Trade the two files between their homes with only two open sectors.'},
    ],
  },
];
