(function(){
  "use strict";

  const SIZE = 4;
  const GAP = 10; // must match the grid-gap used for .board in style.css
  const DIR = { LEFT:0, DOWN:1, RIGHT:2, UP:3 };

  const TILE_BG = ["var(--bg0)","var(--bg2)","var(--bg4)","var(--bg8)","var(--bg16)","var(--bg32)","var(--bg64)",
                    "var(--bg128)","var(--bg256)","var(--bg512)","var(--bg1024)","var(--bg2048)","var(--bg4096)",
                    "var(--bg8192)","var(--bg16384)","var(--bg32768)","var(--bg65536)","var(--bg131072)"];
  const TILE_FG = ["var(--bg0)","var(--fg2)","var(--fg4)","var(--fg8)","var(--fg16)","var(--fg32)",
                    "var(--fg64)","var(--fg128)","var(--fg256)","var(--fg512)","var(--fg1024)","var(--fg2048)","var(--fg4096)",
                    "var(--fg8192)","var(--fg16384)","var(--fg32768)","var(--fg65536)","var(--fg131072)"];
  const MAX_TILE_IDX = TILE_BG.length - 1; // 131072

  const MODS = [
    { key:"gravity",   name:"Gravity",   abbr:"GR", accent:"rgb(93,138,168)",
      desc:"Every move is performed twice." },
    { key:"touch",     name:"Touch",     abbr:"TC", accent:"rgb(0,150,136)",
      desc:"Only adjacent tiles can be merged." },
    { key:"blocked",   name:"Blocked",   abbr:"BL", accent:"rgb(40,36,30)",
      desc:"An unmergeable tile is spawned at the start of the game." },
    { key:"invisible", name:"Invisible", abbr:"IV", accent:"rgb(150,140,140)",
      desc:"Only newly spawned tiles are shown." },
    { key:"coinflip",  name:"Coin Flip", abbr:"CF", accent:"rgb(212,175,55)",
      desc:"2's and 4's are equally likely to spawn." },
    { key:"volatile",  name:"Volatile",  abbr:"VL", accent:"rgb(252, 76, 228)",
      desc:"Two new tiles spawn after every move instead of one." },
    { key:"extrovert", name:"Extrovert", abbr:"XT", accent:"rgb(255, 140, 66)",
      desc:"If the biggest tile sits in the same spot for 7 moves, it swaps with the tile in a fixed spot toward the center. In Chaos Mode this tracking always runs in the background, even while Extrovert isn't the active mod." },
    { key:"lockout",   name:"Lockout",   abbr:"LO", accent:"rgb(255, 79, 79)",
      desc:"A random direction is disabled every move." },
    { key:"magician",  name:"Magician",  abbr:"MG", accent:"rgb(169, 54, 160)",
      desc:"Making the same merge twice spawns a temporary unmergeable block. Make unique merges to make it vanish." },
    { key:"expert",    name:"Expert",    abbr:"EX", accent:"rgb(139, 0, 0)",
      desc:"Tiles are spawned on the worst possible position with the worst possible value." },
  ];

  let nextTileId = 1;

  const state = {
    board: null,          // grid of null | { id, value }
    magicCounter: null,   // grid of numbers, moves alongside board
    score:0, best:0, moveCount:0, gameOver:false,
    lastMergeValue:0,
    spawnLocs: [],
    magicLog: [],   // history of merge values while Magician is active, newest first
    animationsEnabled: true,
    tapControlsEnabled: false,
    theme: "light",
    lockedDir: null, // direction disabled this turn while Lockout is active
    mods: { gravity:false, invisible:false, magician:false, volatile:false, blocked:false, touch:false, coinflip:false, lockout:false, extrovert:false, expert:false },
    chaosMode: false,     // true once the "chaos" cheat code has been typed in the mods menu
    chaosActiveMod: null, // key of the single mod Chaos Mode currently has switched on
    extrovertTracker: {}  // tile id -> { row, col, streak } for Extrovert's "stayed put" tracking
  };

  function loadBestScore() {
    try {
      const saved = localStorage.getItem(getBestScoreKey());
      state.best = saved ? parseInt(saved, 10) : 0;
    } catch(e) {
      state.best = 0;
    }
  }

  try {
    const savedAnim = localStorage.getItem("2048modlab_anim");
    if (savedAnim === "off") state.animationsEnabled = false;
  } catch(e) {}

  try {
    const savedTapControls = localStorage.getItem("2048modlab_tapcontrols");
    if (savedTapControls === "on") state.tapControlsEnabled = true;
  } catch(e) {}

  try {
    const savedTheme = localStorage.getItem("2048modlab_theme");
    if (savedTheme === "dark") state.theme = "dark";
  } catch(e) {}

  function applyTheme(){
    document.documentElement.setAttribute("data-theme", state.theme);
  }
  applyTheme();

  // ---------- helpers ----------

  function getBestScoreKey() {
    if (state.chaosMode) return "2048modlab_best_chaos";

    const active = MODS
    .filter(mod => state.mods[mod.key])
    .map(mod => mod.key)
    .sort();            // ensures order doesn't matter

    return "2048modlab_best_" + active.join("_");
  }

  function emptyGrid(fill){ return Array.from({length:SIZE}, () => Array(SIZE).fill(fill)); }

  function emptyCells(){
    const cells = [];
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (state.board[r][c] === null) cells.push([r,c]);
    return cells;
  }

  function rotateRightOnce(grid){
    const t = emptyGrid(null);
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) t[r][c] = grid[SIZE-1-c][r];
    return t;
  }

  function rotateTimes(n){
    for (let i=0;i<n;i++){
      state.board = rotateRightOnce(state.board);
      state.magicCounter = rotateRightOnce(state.magicCounter);
    }
  }

  function boardsEqual(a,b){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const av = a[r][c], bv = b[r][c];
        if ((av === null) !== (bv === null)) return false;
        if (av && bv && (av.id !== bv.id || av.value !== bv.value)) return false;
      }
    }
    return true;
  }

  function cloneBoard(g){
    return g.map(row => row.map(cell => cell ? { id: cell.id, value: cell.value } : null));
  }

  // ---------- Expert mod: adversarial spawn engine ----------
  // Ported from the standalone "2048?" Expert build. It plays the role of
  // an evil dealer: instead of dropping a random 2 or 4, it runs a shallow
  // expectiminimax search to find whichever empty cell and value hurts the
  // player's position the most. It only ever looks at plain tile values (a
  // flat 16-number array, 0 = empty) -- it never touches the real
  // {id,value} board or tile ids, so it can simulate hypothetical futures
  // with zero risk of corrupting real game state. This engine drives every
  // spawn after a move once Expert is on; the two starting tiles at the
  // beginning of a game are still placed randomly, same as with every
  // other mod.
  const Expert = (function(){
    const evalCache = new Map();
    const PROB_2 = 0.9, PROB_4 = 0.1;

    // ---- move-time budget ----
    // The search below is a real expectiminimax that can go many plies
    // deep once the board gets full (see getMaxDepth). Left unbounded,
    // a single spawn decision can take well over a second late-game,
    // and since it runs synchronously on the main thread, every queued
    // keypress has to wait for it -- that's the "lag while spamming"
    // symptom. Instead of always searching to a fixed depth, we search
    // under a wall-clock deadline: once time's up, any in-progress
    // recursion is truncated to a static evaluation instead of
    // recursing further, so whatever the search has found so far (the
    // ranked candidates are already tried best-first) is returned
    // immediately. Expert therefore always has *a* move ready well
    // within a frame or two, even if it didn't get to look as deep as
    // it ideally would have.
    const MOVE_TIME_BUDGET_MS = 30;
    let searchDeadline = Infinity;
    function timeUp(){ return performance.now() >= searchDeadline; }

    function emptyBoardFlat(){ return new Array(SIZE*SIZE).fill(0); }
    function availableCellsFlat(b){
      const cells = [];
      for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (!b[r*SIZE+c]) cells.push([r,c]);
      return cells;
    }
    function maxTileFlat(b){
      let m = 0;
      for (let i=0;i<SIZE*SIZE;i++) if (b[i] > m) m = b[i];
      return m;
    }
    function cloneFlat(b){ return b.slice(); }

    function slideRow(a,b,c,d){
      let row = [a,b,c,d].filter(v => v);
      let gainedScore = 0;
      const out = [];
      for (let i=0;i<row.length;i++){
        if (i+1 < row.length && row[i] === row[i+1]){
          const val = row[i]*2;
          out.push(val);
          gainedScore += val;
          i++;
        } else {
          out.push(row[i]);
        }
      }
      while (out.length < SIZE) out.push(0);
      return { row: out, score: gainedScore };
    }

    function rotateFlat(b){
      const out = emptyBoardFlat();
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE;c++){
          out[c*SIZE + (SIZE-1-r)] = b[r*SIZE+c];
        }
      }
      return out;
    }

    function moveLeftFlat(b){
      let totalScore = 0, moved = false;
      const newBoard = emptyBoardFlat();
      for (let r=0;r<SIZE;r++){
        const offset = r*SIZE;
        const { row, score } = slideRow(b[offset], b[offset+1], b[offset+2], b[offset+3]);
        totalScore += score;
        for (let c=0;c<SIZE;c++) newBoard[offset+c] = row[c];
        if (!moved){
          for (let c=0;c<SIZE;c++){
            if (b[offset+c] !== newBoard[offset+c]){ moved = true; break; }
          }
        }
      }
      return { board: newBoard, score: totalScore, moved };
    }

    function applyDirectionFlat(b, dir){
      const rotations = [0,3,2,1][dir];
      let cur = b;
      for (let i=0;i<rotations;i++) cur = rotateFlat(cur);
      const res = moveLeftFlat(cur);
      const unrot = (4 - rotations) % 4;
      let nb = res.board;
      for (let i=0;i<unrot;i++) nb = rotateFlat(nb);
      return { board: nb, score: res.score, moved: res.moved };
    }

    const SNAKE_WEIGHTS = [
      65536, 32768, 16384, 8192,
        512,  1024,  2048, 4096,
        256,   128,    64,   32,
          2,     4,     8,   16
    ];

    function snakeScore(b){
      let s = 0;
      for (let i=0;i<SIZE*SIZE;i++) s += b[i] * SNAKE_WEIGHTS[i];
      return s;
    }

    function monotonicityScore(b){
      let s = 0;
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE-1;c++){
          const a = b[r*SIZE+c], d = b[r*SIZE+(c+1)];
          if (a && d) s -= Math.abs(Math.log2(a) - Math.log2(d));
        }
      }
      for (let c=0;c<SIZE;c++){
        for (let r=0;r<SIZE-1;r++){
          const a = b[r*SIZE+c], d = b[(r+1)*SIZE+c];
          if (a && d) s -= Math.abs(Math.log2(a) - Math.log2(d));
        }
      }
      return s;
    }

    function emptySpaceScore(b){
      let n = 0;
      for (let i=0;i<SIZE*SIZE;i++) if (!b[i]) n++;
      return n;
    }

    function mergePotential(b){
      let score = 0;
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE;c++){
          const v = b[r*SIZE+c];
          if (!v) continue;
          if (c+1 < SIZE && b[r*SIZE+(c+1)] === v) score += v;
          if (r+1 < SIZE && b[(r+1)*SIZE+c] === v) score += v;
        }
      }
      return score;
    }

    function evaluateBoardForPlayer(b){
      const k = b.join(",");
      if (evalCache.has(k)) return evalCache.get(k);
      const v = (
        snakeScore(b)                 * 0.00001 +
        monotonicityScore(b)          * 1       +
        emptySpaceScore(b)            * 10      +
        mergePotential(b)             * 0.5     +
        Math.log2(maxTileFlat(b) + 1) * 20
      );
      evalCache.set(k, v);
      return v;
    }

    function anchorLevel(r,c){
      return ((r === 0 || r === SIZE-1) ? 1 : 0) + ((c === 0 || c === SIZE-1) ? 1 : 0);
    }

    function findBigTile(b){
      let bigVal=0, bigR=0, bigC=0;
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE;c++){
          const v = b[r*SIZE+c];
          if (v > bigVal){ bigVal=v; bigR=r; bigC=c; }
        }
      }
      return { val: bigVal, r: bigR, c: bigC };
    }

    function bigTileAfterMove(b, dir){
      const { board: nb, moved } = applyDirectionFlat(b, dir);
      if (!moved) return null;
      const { r, c } = findBigTile(nb);
      return { r, c };
    }

    function cornerEscapeScore(b, spawnR, spawnC, spawnVal){
      const big = findBigTile(b);
      if (!big.val) return 0;
      const bigAnchor = anchorLevel(big.r, big.c);
      if (bigAnchor === 0) return 0;

      const tmp = cloneFlat(b);
      tmp[spawnR*SIZE+spawnC] = spawnVal;
      let safeMovesBefore = 0, safeMovesAfter = 0;

      for (let dir=0; dir<4; dir++){
        const origResult = bigTileAfterMove(b, dir);
        if (origResult && anchorLevel(origResult.r, origResult.c) >= bigAnchor) safeMovesBefore++;
        const spawnResult = bigTileAfterMove(tmp, dir);
        if (spawnResult && anchorLevel(spawnResult.r, spawnResult.c) >= bigAnchor) safeMovesAfter++;
      }

      const safeMovesEliminated = safeMovesBefore - safeMovesAfter;
      const anchorBonus = safeMovesEliminated * big.val * big.val * 0.5;
      const noSafeMoveBonus = (safeMovesAfter === 0 && safeMovesBefore > 0) ? big.val * big.val * 2 : 0;

      let adjacencyBonus = 0;
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nr = big.r+dr, nc = big.c+dc;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
        if (nr === spawnR && nc === spawnC) adjacencyBonus += big.val * 50;
      }

      let trapBonus = 0;
      if (bigAnchor === 2){
        const escapeRow = (big.r === 0) ? 1 : SIZE-2;
        const escapeCol = (big.c === 0) ? 1 : SIZE-2;
        if ((spawnR === escapeRow && spawnC === big.c) || (spawnR === big.r && spawnC === escapeCol)){
          trapBonus += big.val * big.val * 0.3;
        }
      }
      return anchorBonus + noSafeMoveBonus + adjacencyBonus + trapBonus;
    }

    function bigTileBlockScore(b, spawnR, spawnC){
      const big = findBigTile(b);
      if (!big.val || big.r === 0 || big.r === SIZE-1 || big.c === 0 || big.c === SIZE-1) return 0;

      const corners = [[0,0],[0,SIZE-1],[SIZE-1,0],[SIZE-1,SIZE-1]];
      let score = 0;

      const wallTargets = [
        { r:0, c:big.c, dir:"up" },
        { r:SIZE-1, c:big.c, dir:"down" },
        { r:big.r, c:0, dir:"left" },
        { r:big.r, c:SIZE-1, dir:"right" }
      ];

      for (const target of wallTargets){
        const sameColumn = spawnC === big.c;
        const sameRow = spawnR === big.r;
        const onPath = (target.dir === "up" && sameColumn && spawnR < big.r) ||
                       (target.dir === "down" && sameColumn && spawnR > big.r) ||
                       (target.dir === "left" && sameRow && spawnC < big.c) ||
                       (target.dir === "right" && sameRow && spawnC > big.c);
        if (!onPath) continue;

        const toWall = target.dir === "up" || target.dir === "down" ? Math.abs(target.r - big.r) : Math.abs(target.c - big.c);
        const toSpawn = Math.abs(spawnR - big.r) + Math.abs(spawnC - big.c);
        const closeness = 1 + (toWall - toSpawn) / toWall;
        score += big.val * big.val * closeness;
      }

      for (const [cornerR, cornerC] of corners){
        const horizontalThenVertical =
          (spawnR === big.r && ((cornerC > big.c && spawnC > big.c && spawnC <= cornerC) || (cornerC < big.c && spawnC < big.c && spawnC >= cornerC))) ||
          (spawnC === cornerC && ((cornerR > big.r && spawnR > big.r && spawnR <= cornerR) || (cornerR < big.r && spawnR < big.r && spawnR >= cornerR)));
        const verticalThenHorizontal =
          (spawnC === big.c && ((cornerR > big.r && spawnR > big.r && spawnR <= cornerR) || (cornerR < big.r && spawnR < big.r && spawnR >= cornerR))) ||
          (spawnR === cornerR && ((cornerC > big.c && spawnC > big.c && spawnC <= cornerC) || (cornerC < big.c && spawnC < big.c && spawnC >= cornerC)));

        if (!horizontalThenVertical && !verticalThenHorizontal) continue;

        const toCorner = Math.abs(cornerR - big.r) + Math.abs(cornerC - big.c);
        const toSpawn = Math.abs(spawnR - big.r) + Math.abs(spawnC - big.c);
        const closeness = 1 + (toCorner - toSpawn) / toCorner;
        score += big.val * big.val * closeness;
      }

      if (spawnR === big.r || spawnC === big.c) score += big.val * 25;
      return score;
    }

    function simulatePlayerBest(b){
      let best = -Infinity;
      for (let dir=0; dir<4; dir++){
        const { board: nb, moved, score } = applyDirectionFlat(b, dir);
        if (!moved) continue;
        let mergeScore = 0;
        for (let r=0;r<SIZE;r++){
          for (let c=0;c<SIZE;c++){
            const v = b[r*SIZE+c];
            if (!v) continue;
            if (c+1 < SIZE && nb[r*SIZE+(c+1)] === v) mergeScore += v*v;
            if (r+1 < SIZE && nb[(r+1)*SIZE+c] === v) mergeScore += v*v;
          }
        }
        best = Math.max(best, mergeScore + score*score);
      }
      return best === -Infinity ? 0 : best;
    }

    function countFutureMerges(b){
      let total = 0;
      for (let dir=0; dir<4; dir++){
        const { board: nb, moved } = applyDirectionFlat(b, dir);
        if (!moved) continue;
        for (let r=0;r<SIZE;r++){
          for (let c=0;c<SIZE;c++){
            const v = b[r*SIZE+c];
            if (!v) continue;
            if (c+1 < SIZE && nb[r*SIZE+(c+1)] === v) total += v*v;
            if (r+1 < SIZE && nb[(r+1)*SIZE+c] === v) total += v*v;
          }
        }
      }
      return total;
    }

    function cellDisruptionProfile(b, r, c){
      return {
        block: bigTileBlockScore(b, r, c),
        escape2: cornerEscapeScore(b, r, c, 2),
        escape4: cornerEscapeScore(b, r, c, 4)
      };
    }

    function spawnImpactScore(b, r, c, val, profile){
      const tmp = cloneFlat(b);
      tmp[r*SIZE+c] = val;
      let sc = -(simulatePlayerBest(tmp) - simulatePlayerBest(b));
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nr = r+dr, nc = c+dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE){
          const neighbor = b[nr*SIZE+nc];
          if (neighbor === val) sc += 100 + val*val;
          else if (neighbor > val) sc += neighbor*5;
        }
      }
      sc -= countFutureMerges(tmp);
      let rowColMatches = 0;
      for (let i=0;i<SIZE;i++){
        if (b[r*SIZE+i] === val && i !== c) rowColMatches++;
        if (b[i*SIZE+c] === val && i !== r) rowColMatches++;
      }
      sc += rowColMatches * val * 10;
      const p = profile || cellDisruptionProfile(b, r, c);
      sc += (val === 2 ? p.escape2 : p.escape4);
      sc += p.block;
      sc += (snakeScore(b) - snakeScore(tmp)) * 0.01;
      sc += (monotonicityScore(b) - monotonicityScore(tmp)) * 100;
      sc += (16 - emptySpaceScore(tmp)) * 500;
      return sc;
    }

    function expectiminimaxMax(b, depth, ceiling = Infinity, beta = Infinity){
      if (depth <= 0 || timeUp()) return evaluateBoardForPlayer(b);
      let best = -Infinity, anyMoved = false;
      for (let dir=0; dir<4; dir++){
        const { board: nb, moved } = applyDirectionFlat(b, dir);
        if (!moved) continue;
        anyMoved = true;
        const val = expectiminimaxChance(nb, depth-1, ceiling);
        if (val > best) best = val;
        if (best >= beta) return best;
        if (timeUp()) break;
      }
      return anyMoved ? best : evaluateBoardForPlayer(b);
    }

    function expectiminimaxChance(b, depth, ceiling = Infinity){
      const empty = availableCellsFlat(b);
      if (!empty.length || timeUp()) return evaluateBoardForPlayer(b);

      const maxCells = depth >= 4 ? 4 : depth >= 2 ? 6 : 8;
      const cells = empty.length > maxCells ? evilSampleCells(b, empty, maxCells) : empty;

      let worstExpected = Infinity;
      for (const idx of cells){
        const b2 = cloneFlat(b); b2[idx[0]*SIZE+idx[1]] = 2;
        const b4 = cloneFlat(b); b4[idx[0]*SIZE+idx[1]] = 4;
        const ev2 = (depth <= 1) ? evaluateBoardForPlayer(b2) : expectiminimaxMax(b2, depth-1, worstExpected);
        const ev4 = (depth <= 1) ? evaluateBoardForPlayer(b4) : expectiminimaxMax(b4, depth-1, worstExpected);
        const expected = PROB_2*ev2 + PROB_4*ev4;

        if (expected < worstExpected) worstExpected = expected;
        if (worstExpected < ceiling * 0.85) return worstExpected;
        if (timeUp()) break;
      }
      return worstExpected;
    }

    function getMaxDepth(b){
      // Adaptive again: an emptier board means more legitimately different
      // spawn options worth comparing, so we go shallower-but-wider (see
      // the cap in findBestAdversarialSpawn) rather than spending the whole
      // time budget going deep on a handful of pre-judged cells. As cells
      // fill in there's less to choose between, so we can afford to go
      // deeper on the few candidates that remain.
      const emptyCount = availableCellsFlat(b).length;
      if (emptyCount <= 3) return 7;
      if (emptyCount <= 6) return 6;
      if (emptyCount <= 10) return 5;
      return 4;
    }

    // Ranks empty cells by how disruptive a spawn there would actually be,
    // so the search's candidate shortlist (see findBestAdversarialSpawn)
    // reflects the live board instead of pure geometry. This used to lean
    // almost entirely on distance-from-center (a constant x10 term), with
    // the real board-aware signals (block/escape scores) scaled down to
    // x0.0001 -- effectively invisible. That made the four corners win the
    // pre-filter on every board regardless of whether anything interesting
    // was actually happening there, so Expert always narrowed its search
    // down to corner candidates before the real search even ran. Now the
    // board-aware terms dominate, and position on the grid only matters
    // through mechanics that actually make it matter (trapping or blocking
    // the current biggest tile).
    function evilCellPriority(b, r, c, profile){
      const p = profile || cellDisruptionProfile(b, r, c);
      const disruption = p.block + p.escape2 + p.escape4;

      // Local pressure: sitting next to existing tiles is what makes a
      // spawn actually interfere with the player -- it can block a merge,
      // clutter a run, or crowd something big. An isolated cell out in
      // empty space does comparatively little regardless of where it sits.
      let neighbourPressure = 0, neighbourMax = 0, adjacentTiles = 0;
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nr = r+dr, nc = c+dc;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
        const nv = b[nr*SIZE+nc];
        if (!nv) continue;
        neighbourMax = Math.max(neighbourMax, nv);
        neighbourPressure += nv;
        adjacentTiles++;
      }

      // A light tie-breaker only, not the dominant term: all else equal,
      // slightly prefer cells nearer the middle of the board since they
      // touch more of the player's options.
      const centralityNudge = 3 - (Math.abs(r - 1.5) + Math.abs(c - 1.5));

      return disruption + neighbourPressure * 3 + adjacentTiles * 40 +
             Math.log2(neighbourMax + 1) * 5 + centralityNudge * 2;
    }

    function evilSampleCells(b, cells, n){
      if (cells.length <= n) return cells;
      return cells.slice()
        .sort((a, bv) => evilCellPriority(b, bv[0], bv[1]) - evilCellPriority(b, a[0], a[1]))
        .slice(0, n);
    }

    function findBestAdversarialSpawn(b, maxDepth){
      const empty = availableCellsFlat(b);
      if (!empty.length) return null;

      const profiles = new Map();
      for (const [r,c] of empty) profiles.set(r*SIZE+c, cellDisruptionProfile(b, r, c));

      const ranked = empty.slice().sort((a, bb) => {
        const pa = profiles.get(a[0]*SIZE+a[1]);
        const pb = profiles.get(bb[0]*SIZE+bb[1]);
        return evilCellPriority(b, bb[0], bb[1], pb) - evilCellPriority(b, a[0], a[1], pa);
      });

      const cap = maxDepth >= 5 ? 6 : maxDepth >= 3 ? 9 : ranked.length;
      const candidates = ranked.length > cap ? ranked.slice(0, cap) : ranked;

      const EPS = 1e-6;
      let worstScore = Infinity, worstCell = null, worstVal = 2, worstImpact = -Infinity;

      // Candidates are already ranked best-first (most disruptive cell
      // heuristically first), so if the time budget runs out partway
      // through, whatever's been evaluated so far is still a good pick --
      // we just stop looking for something even better instead of
      // leaving the move undecided.
      for (const [r,c] of candidates){
        const profile = profiles.get(r*SIZE+c);
        for (const val of [2,4]){
          const tmp = cloneFlat(b);
          tmp[r*SIZE+c] = val;
          const playerScore = expectiminimaxMax(tmp, maxDepth-1, Infinity, worstScore);
          const impact = spawnImpactScore(b, r, c, val, profile);
          const better = playerScore < worstScore - EPS ||
                         (Math.abs(playerScore - worstScore) < EPS && impact > worstImpact);
          if (better){
            worstScore = playerScore; worstCell = [r,c];
            worstVal = val; worstImpact = impact;
          }
        }
        if (timeUp() && worstCell) break;
      }
      if (!worstCell){ const [r,c] = empty[0]; return { r, c, val: 2, score: 0 }; }
      return { r: worstCell[0], c: worstCell[1], val: worstVal, score: worstScore };
    }

    function midpointCell(b, p1, p2){
      const mr = (p1.r + p2.r)/2, mc = (p1.c + p2.c)/2;
      const empty = availableCellsFlat(b);
      if (!empty.length) return null;
      empty.sort((a, bv) => {
        const da = (a[0]-mr)**2 + (a[1]-mc)**2;
        const db = (bv[0]-mr)**2 + (bv[1]-mc)**2;
        return da - db;
      });
      return { r: empty[0][0], c: empty[0][1] };
    }

    function findBlockablePair(b){
      const tiles = [];
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE;c++){
          if (b[r*SIZE+c]) tiles.push({ r, c, val: b[r*SIZE+c] });
        }
      }
      if (tiles.length > 3) return null;
      for (let i=0;i<tiles.length;i++){
        for (let j=i+1;j<tiles.length;j++){
          const a = tiles[i], bb = tiles[j];
          if (a.val !== bb.val) continue;
          if (a.r !== bb.r && a.c !== bb.c) continue;
          return { p1: a, p2: bb, val: a.val };
        }
      }
      return null;
    }

    function deviousSpawn(b){
      const empty = availableCellsFlat(b);
      if (!empty.length) return null;

      // Fresh deadline for this spawn decision. Everything below (the
      // expectiminimax recursion and the candidate loop) checks timeUp()
      // and unwinds gracefully once it's passed, so this call always
      // returns quickly instead of blocking the main thread until a
      // fixed search depth finishes.
      searchDeadline = performance.now() + MOVE_TIME_BUDGET_MS;

      const pair = findBlockablePair(b);
      if (pair){
        const mid = midpointCell(b, pair.p1, pair.p2);
        if (mid) return { r: mid.r, c: mid.c, val: 4 };
      }

      const depth = getMaxDepth(b);
      return findBestAdversarialSpawn(b, depth);
    }

    return {
      pickSpawn: function(flatBoard){ return deviousSpawn(flatBoard); }
    };
  })();

  // Converts the live {id,value} board into the flat number array the
  // Expert engine works with, runs its adversarial search, and places the
  // result as a real tile. Blocked's obstacle sentinel (1) and Magician's
  // TV-static sentinel (-1) are remapped to an ordinary positive number
  // first so they read as "occupied" to the engine instead of tripping up
  // its math (it takes log2() of tile values, which breaks on negatives).
  function expertSpawn(){
    const cells = emptyCells();
    if (cells.length === 0) return null;

    const flat = new Array(SIZE*SIZE).fill(0);
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cell = state.board[r][c];
        flat[r*SIZE+c] = cell ? (cell.value > 0 ? cell.value : 2) : 0;
      }
    }

    const chosen = Expert.pickSpawn(flat);
    if (!chosen) return null;

    state.board[chosen.r][chosen.c] = { id: nextTileId++, value: chosen.val };
    return chosen.r*SIZE + chosen.c;
  }

  // ---------- game setup ----------
  function newGame(){
    if (state.chaosMode){
      if (state.chaosActiveMod === "blocked") removeBlockedTiles();
      if (state.chaosActiveMod === "magician") removeMagicTiles();
      if (state.chaosActiveMod) state.mods[state.chaosActiveMod] = false;

      const key = chaosPickDifferentMod(state.chaosActiveMod);
      state.mods[key] = true;
      state.chaosActiveMod = key;
    }

    state.board = emptyGrid(null);
    state.magicCounter = emptyGrid(0);
    state.score = 0;
    state.moveCount = 0;
    state.gameOver = false;
    state.lastMergeValue = 0;
    state.spawnLocs = [];
    state.magicLog = [];
    state.lockedDir = null;
    state.extrovertTracker = {};

    const s1 = randomSpawn();
    const s2 = randomSpawn();
    state.spawnLocs = [s1, s2].filter(x => x !== null);

    if (state.mods.blocked) randomSpawnBlock();

    pickLockout();

    hideOverlay();
    lossFlashEl.classList.remove("pulse");
    stopAllMagicAnimations();
    tilesLayerEl.innerHTML = "";
    tileEls.clear();
    render();
  }

  function randomSpawn(){
    const cells = emptyCells();
    if (cells.length === 0) return null;
    const val = Math.random() < (state.mods.coinflip ? 0.5 : 0.1) ? 4 : 2;
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    state.board[r][c] = { id: nextTileId++, value: val };
    return r*SIZE + c;
  }

  function randomSpawnBlock(){
    const cells = emptyCells();
    if (cells.length === 0) return null;
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    state.board[r][c] = { id: nextTileId++, value: 1 }; // sentinel: permanent obstacle tile
    return r*SIZE + c;
  }

  // Clears every obstacle tile (the Blocked mod's sentinel value) off the
  // board. Used when Chaos Mode switches away from Blocked, since those
  // tiles are only meant to exist while Blocked is the active mod.
  function removeBlockedTiles(){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        if (state.board[r][c] && state.board[r][c].value === 1){
          state.board[r][c] = null;
          state.magicCounter[r][c] = 0;
        }
      }
    }
  }

  // ---------- move + merge ----------
  const BLOCKED = 0, MOVED = 1, MERGED = 2;

  function moveTileLeft(row, col, merged, mergeValues){
    const b = state.board, m = state.magicCounter;
    if (col === 0) return BLOCKED;

    if (b[row][col-1] === null){
      b[row][col-1] = b[row][col];
      m[row][col-1] = m[row][col];
      b[row][col] = null;
      m[row][col] = 0;
      return MOVED;
    }

    if (state.mods.magician && (m[row][col] !== 0 || m[row][col-1] !== 0)) return BLOCKED;

    if (b[row][col-1].value !== b[row][col].value) return BLOCKED;

    if (!merged[row][col-1]){
      const preMergeValue = b[row][col].value;
      b[row][col-1].value *= 2;
      b[row][col] = null;
      merged[row][col-1] = 1;
      state.score += b[row][col-1].value;
      
      mergeValues.push(preMergeValue);
      return MERGED;
    }

    return BLOCKED;
  }

  // "Touch" mod merge rule: two tiles merge only if their ORIGINAL columns
  // were exactly one apart, i.e. nothing (not even an empty cell) separated
  // them. Either or both tiles may still slide to meet in the middle; that
  // doesn't disqualify the merge. A tile that already merged this move can't
  // merge again (no chains). Ported from 2048_touch.c's merge_row_left().
  function mergeRowTouchLeft(row, magicRow, mergeValues){
    const newRow = [null, null, null, null];
    const newMagic = [0, 0, 0, 0];
    let writeIndex = 0;
    let lastOrigCol = -2;   // original column of the tile now at newRow[writeIndex-1]
    let lastMerged = false; // whether that tile already merged this move

    for (let col=0; col<SIZE; col++){
      const cell = row[col];
      if (cell === null) continue;

      const prev = writeIndex > 0 ? newRow[writeIndex-1] : null;
      const prevMagic = writeIndex > 0 && state.mods.magician && newMagic[writeIndex-1] !== 0;
      const curMagic = state.mods.magician && magicRow[col] !== 0;

      if (prev !== null &&
          !lastMerged &&
          !prevMagic && !curMagic &&
          prev.value === cell.value &&
          (col - lastOrigCol === 1)){
        // Same value, previous tile hasn't merged yet, and the two tiles
        // were originally touching (no gap between them).
        newRow[writeIndex-1] = { id: prev.id, value: prev.value * 2 };
        state.score += newRow[writeIndex-1].value;
        mergeValues.push(newRow[writeIndex-1].value);
        lastMerged = true;
        lastOrigCol = col;
      } else {
        newRow[writeIndex] = cell;
        newMagic[writeIndex] = magicRow[col];
        writeIndex += 1;
        lastMerged = false;
        lastOrigCol = col;
      }
    }

    for (let i=0; i<SIZE; i++){
      row[i] = newRow[i];
      magicRow[i] = newMagic[i];
    }
  }

  function moveAndMergeOnce(direction){
    const mergeValues = [];

    rotateTimes(direction);

    if (state.mods.touch){
      for (let row=0; row<SIZE; row++){
        mergeRowTouchLeft(state.board[row], state.magicCounter[row], mergeValues);
      }
    } else {
      const merged = emptyGrid(0);
      for (let row=0; row<SIZE; row++){
        for (let col=0; col<SIZE; col++){
          if (state.board[row][col] === null) continue;
          let tempCol = col;
          let ret;
          do{
            ret = moveTileLeft(row, tempCol, merged, mergeValues);
            if (ret === MOVED) tempCol -= 1;
          } while (ret === MOVED);
        }
      }
    }

    rotateTimes((SIZE - direction) % SIZE);
    return mergeValues;
  }

  // ---------- lockout mechanics ----------
  // Dry-runs a move on a scratch copy of the board to see whether it would
  // change anything, without touching real game state (score included).
  function wouldMoveChange(direction){
    const savedBoard = state.board;
    const savedMagic = state.magicCounter;
    const savedScore = state.score;

    state.board = cloneBoard(savedBoard);
    state.magicCounter = savedMagic.map(row => row.slice());
    const before = cloneBoard(state.board);
    moveAndMergeOnce(direction);
    const changed = !boardsEqual(before, state.board);

    state.board = savedBoard;
    state.magicCounter = savedMagic;
    state.score = savedScore;
    return changed;
  }

  // Picks a random direction to disable for the upcoming move. Never locks
  // the player's only remaining legal move.
  function pickLockout(){
    if (!state.mods.lockout){ state.lockedDir = null; return; }

    const allDirs = [DIR.LEFT, DIR.RIGHT, DIR.UP, DIR.DOWN];
    const validDirs = allDirs.filter(d => wouldMoveChange(d));

    let candidates = allDirs;
    if (validDirs.length <= 1){
      candidates = allDirs.filter(d => d !== validDirs[0]);
    }

    if (candidates.length === 0){ state.lockedDir = null; return; }
    state.lockedDir = candidates[Math.floor(Math.random() * candidates.length)];
  }

  // ---------- extrovert mechanics ----------
  // Every cell has a fixed "home" cell it teleports to. The four center
  // cells are everyone's ultimate home and map to themselves; the twelve
  // outer cells each belong to one of the four corner "cliques" (the corner
  // plus its two orthogonal neighbors) and map to the center cell on the
  // opposite side of the board, mirrored through the middle.
  const EXTROVERT_TARGET = [
    [[2,2],[2,2],[2,1],[2,1]],
    [[2,2],[1,1],[1,2],[2,1]],
    [[1,2],[2,1],[2,2],[1,1]],
    [[1,2],[1,2],[1,1],[1,1]]
  ];
  const EXTROVERT_STREAK_NEEDED = 8;

  // Extrovert's position tracking runs whenever the mod itself is on, and
  // also passively throughout all of Chaos Mode (per its own special rule),
  // even on moves where some other mod is the one currently switched on.
  function extrovertIsTracking(){
    return state.mods.extrovert || state.chaosMode;
  }
  
  function extrovertIsActive(){
      return state.mods.extrovert;
  }

  // Briefly rings the given cell to call out a teleport swap.
  function spawnExtrovertGlow(r, c){
    const total = tilesLayerEl.clientWidth || tilesLayerEl.offsetWidth || 0;
    const cell = Math.max(0, (total - GAP*(SIZE-1)) / SIZE);
    const x = c*(cell+GAP), y = r*(cell+GAP);

    const glow = document.createElement("div");
    glow.className = "extrovert-glow";
    glow.style.width = cell + "px";
    glow.style.height = cell + "px";
    glow.style.transform = `translate(${x}px, ${y}px)`;
    tilesLayerEl.appendChild(glow);
    setTimeout(() => glow.remove(), 650);
  }

  // Called once per successful move. Finds whichever tile(s) currently hold
  // the board's highest value, tracks how many moves in a row each has sat
  // in the same cell, and teleport-swaps any that have overstayed their
  // welcome (7+ moves) with the tile at their fixed home cell.
  function processExtrovert(){
    if (!extrovertIsTracking()){
      state.extrovertTracker = {};
      return;
    }

    let maxVal = 0;
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cell = state.board[r][c];
        if (cell && cell.value > 1 && cell.value > maxVal) maxVal = cell.value;
      }
    }
    if (maxVal === 0) return;

    const stillHolding = new Set();

    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        // --- ADD THIS CHECK ---
        // Skip tracking if the tile is in one of the center cells:
        // (1,1), (1,2), (2,1), or (2,2)
        if ((r === 1 || r === 2) && (c === 1 || c === 2)) continue;
        // ----------------------

        const cell = state.board[r][c];
        if (!cell || cell.value !== maxVal) continue;

        const id = cell.id;
        stillHolding.add(id);
        const prev = state.extrovertTracker[id];

        if (prev && prev.row === r && prev.col === c){
          prev.streak += 1;
          prev.value = maxVal;
        } else {
          state.extrovertTracker[id] = { row:r, col:c, streak:1, value:maxVal };
        }

        if (
            extrovertIsActive() &&
            state.extrovertTracker[id].streak >= EXTROVERT_STREAK_NEEDED
        ){
          const [tr, tc] = EXTROVERT_TARGET[r][c];
          delete state.extrovertTracker[id];

          if (tr !== r || tc !== c){
            const other = state.board[tr][tc];
            state.board[r][c] = other;
            state.board[tr][tc] = cell;

            const tmpMagic = state.magicCounter[r][c];
            state.magicCounter[r][c] = state.magicCounter[tr][tc];
            state.magicCounter[tr][tc] = tmpMagic;

            if (other) delete state.extrovertTracker[other.id];

            spawnExtrovertGlow(r, c);
            spawnExtrovertGlow(tr, tc);
          }
        }
      }
    }

    for (const idKey in state.extrovertTracker){
      if (!stillHolding.has(Number(idKey))) delete state.extrovertTracker[idKey];
    }
  }

  // ---------- chaos mode ----------
  // Picks a mod key other than the one passed in.
  function chaosPickDifferentMod(excludeKey){
    const candidates = MODS.map(m => m.key).filter(k => k !== excludeKey);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Turns Chaos Mode on (picking one random starting mod) or off (dropping
  // whatever mod it currently has active). Always starts a fresh game after,
  // same as toggling a mod square by hand.
  function setChaosMode(on){
    state.chaosMode = on;
    MODS.forEach(m => state.mods[m.key] = false);
    state.chaosActiveMod = null;

    loadBestScore();
    newGame();       // newGame() picks the starting mod itself when chaosMode is true
    syncModCards();  // sync AFTER, so the menu reflects whatever newGame() landed on
  }

  // Called once per successful move while Chaos Mode is active. 10% chance
  // to swap the currently active mod out for a different random one.
  // Returns true if the swap just turned Blocked on, so the caller can spawn
  // an obstacle tile in place of this move's natural spawn.
  function maybeChaosSwitch(){
    if (!state.chaosMode) return false;
    if (Math.random() >= 0.10) return false;

    const oldKey = state.chaosActiveMod;
    const newKey = chaosPickDifferentMod(oldKey);

    if (oldKey){
      state.mods[oldKey] = false;
      if (oldKey === "blocked") removeBlockedTiles();
      if (oldKey === "magician") removeMagicTiles();
    }

    state.mods[newKey] = true;
    state.chaosActiveMod = newKey;

    return newKey === "blocked";
  }

  // ---------- magician mechanics ----------
  function getHighestTile(){
    let highest = 0;
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++){
      const cell = state.board[r][c];
      if (state.magicCounter[r][c] === 0 && cell && cell.value > highest) highest = cell.value;
    }
    return highest;
  }

  function magicCounterValue(highest){
    if (highest < 4) return 1;
    let counter = Math.floor(Math.log2(highest) + 1e-6) - 1;
    if (counter < 1) counter = 1;
    return counter;
  }

  function spawnMagicBlock(){
    const cells = emptyCells();
    if (cells.length === 0) return;
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    const highest = getHighestTile();
    state.board[r][c] = { id: nextTileId++, value: -1 }; // magic sentinel
    state.magicCounter[r][c] = magicCounterValue(highest);
  }

  // Clears every magic (TV-static) sentinel tile off the board. Used when
  // Chaos Mode switches away from Magician, since those tiles only make
  // sense while Magician is the active mod.
  function removeMagicTiles(){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        if (state.magicCounter[r][c] !== 0){
          state.board[r][c] = null;
          state.magicCounter[r][c] = 0;
        }
      }
    }
  }

  function processMagic(mergeValues){
    let decrementThisMove = false;
    let spawnsNeeded = 0;

    for (let i=0;i<mergeValues.length;i++){
      let isDup = false;
      if (state.lastMergeValue === mergeValues[i]) isDup = true;
      for (let j=0;j<i;j++){ if (mergeValues[j] === mergeValues[i]){ isDup = true; break; } }
      if (isDup) spawnsNeeded++; else decrementThisMove = true;
    }

    if (mergeValues.length > 0) state.lastMergeValue = mergeValues[mergeValues.length-1];

    if (decrementThisMove && spawnsNeeded === 0){
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE;c++){
          if (state.magicCounter[r][c] > 0){
            state.magicCounter[r][c]--;
            if (state.magicCounter[r][c] === 0) state.board[r][c] = null;
          }
        }
      }
    }

    for (let i=0;i<spawnsNeeded;i++) spawnMagicBlock();
  }

  // ---------- loss detection ----------
  function isLost(){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cur = state.board[r][c];
        if (cur === null) return false;
        const curMagic = state.mods.magician && state.magicCounter[r][c] !== 0;
        if (r !== SIZE-1){
          const down = state.board[r+1][c];
          if (down){
            const downMagic = state.mods.magician && state.magicCounter[r+1][c] !== 0;
            if (!curMagic && !downMagic && cur.value === down.value) return false;
          }
        }
        if (c !== SIZE-1){
          const right = state.board[r][c+1];
          if (right){
            const rightMagic = state.mods.magician && state.magicCounter[r][c+1] !== 0;
            if (!curMagic && !rightMagic && cur.value === right.value) return false;
          }
        }
      }
    }
    return true;
  }

  // ---------- top level move ----------
  function handleMove(direction){
    if (state.gameOver) return;
    if (modalOverlay.classList.contains("show")) return;
    if (state.mods.lockout && state.lockedDir === direction) return;

    const before = cloneBoard(state.board);
    let mergeValues = moveAndMergeOnce(direction);

    if (state.mods.gravity){
      mergeValues = mergeValues.concat(moveAndMergeOnce(direction));
    }

    let justSpawned = [];

    const changed = !boardsEqual(before, state.board);

    if (changed){
      if (state.mods.magician){
        processMagic(mergeValues);
        
        // ONLY update the log if a merge actually happened this turn
        if (mergeValues.length > 0) {
          state.magicLog = [...mergeValues].sort((a, b) => b - a);
        }
        // If mergeValues.length is 0, we do NOTHING, 
        // leaving the old state.magicLog exactly as it was.
      }

      const chaosSwitchedToBlocked = state.chaosMode ? maybeChaosSwitch() : false;

      if (chaosSwitchedToBlocked){
        // Blocked just got dealt in by Chaos Mode: its obstacle tile takes
        // priority over the normal random spawn this move.
        const sB = randomSpawnBlock();
        if (sB !== null) justSpawned.push(sB);
      } else {
        const s1 = state.mods.expert ? expertSpawn() : randomSpawn();
        if (s1 !== null) justSpawned.push(s1);
        if (state.mods.volatile){
          const s2 = state.mods.expert ? expertSpawn() : randomSpawn();
          if (s2 !== null) justSpawned.push(s2);
        }
      }
      state.spawnLocs = justSpawned;

      state.moveCount += 1;
      if (state.score > state.best){
        state.best = state.score;
        try { localStorage.setItem(getBestScoreKey(), String(state.best)); } catch(e) {}
      }

      processExtrovert();
      pickLockout();
    }

    const wasGameOver = state.gameOver;
    if (isLost()){
      state.gameOver = true;
    }

    render();

    if (state.gameOver){
      if (!wasGameOver) triggerLossFlash();
    }
  }

  // ---------- rendering ----------
  const cellGridEl = document.getElementById("cellGrid");
  const tilesLayerEl = document.getElementById("tilesLayer");
  const scoreValEl = document.getElementById("scoreVal");
  const bestValEl = document.getElementById("bestVal");
  const movesValEl = document.getElementById("movesVal");
  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlaySubEl = document.getElementById("overlaySub");
  const activeModsRow = document.getElementById("activeModsRow");
  const modalOverlay = document.getElementById("modalOverlay");
  const magicLogEl = document.getElementById("magicLog");
  const magicLogListEl = document.getElementById("magicLogList");
  const extrovertLogEl = document.getElementById("extrovertLog");
  const extrovertLogListEl = document.getElementById("extrovertLogList");
  const overlayCloseBtn = document.getElementById("overlayClose");
  const boardWrapEl = document.getElementById("boardWrap");
  const lossFlashEl = document.getElementById("lossFlash");
  const lockoutGlowEls = {
    [DIR.LEFT]:  document.getElementById("lockoutGlowLeft"),
    [DIR.RIGHT]: document.getElementById("lockoutGlowRight"),
    [DIR.UP]:    document.getElementById("lockoutGlowUp"),
    [DIR.DOWN]:  document.getElementById("lockoutGlowDown"),
  };
  const tapZoneEls = {
    [DIR.UP]:    document.getElementById("tapZoneUp"),
    [DIR.DOWN]:  document.getElementById("tapZoneDown"),
    [DIR.LEFT]:  document.getElementById("tapZoneLeft"),
    [DIR.RIGHT]: document.getElementById("tapZoneRight"),
  };

  // static empty cell backgrounds, built once
  for (let i=0;i<16;i++){
    const d = document.createElement("div");
    d.className = "cell-bg";
    cellGridEl.appendChild(d);
  }

  // persistent DOM tile elements keyed by tile id, so CSS transitions can
  // animate a tile moving between renders instead of it being torn down
  // and rebuilt from scratch every time.
  const tileEls = new Map();

  // ---------- magic tile TV-static animation ----------
  // Each magic tile gets its own <canvas> driving a noise effect (per-pixel
  // crossfade between random bytes), keyed by the tile's persistent DOM
  // element so it survives re-renders and only tears down when the tile
  // itself is removed from the board.
  const magicAnimators = new Map(); // el -> { raf }

  function stopMagicAnimation(el){
    const anim = magicAnimators.get(el);
    if (anim){
      cancelAnimationFrame(anim.raf);
      magicAnimators.delete(el);
    }
  }

  function stopAllMagicAnimations(){
    for (const el of Array.from(magicAnimators.keys())) stopMagicAnimation(el);
  }

  function startMagicAnimation(el, canvas){
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const n = w * h;

    const img = ctx.createImageData(w, h);
    const d = img.data;
    const bufA = new Uint8Array(n);
    const bufB = new Uint8Array(n);
    for (let i=0;i<n;i++){
      bufA[i] = Math.floor(Math.random()*256);
      bufB[i] = Math.floor(Math.random()*256);
    }

    const progress = new Float32Array(n);
    const speeds = new Float32Array(n);
    for (let i=0;i<n;i++){
      progress[i] = Math.random();
      speeds[i] = 0.5 + Math.random()*0.5;
    }

    const anim = { raf: null };
    magicAnimators.set(el, anim);

    function frame(){
      for (let i=0;i<n;i++){
        progress[i] += 0.02 * speeds[i];
        if (progress[i] >= 1){
          bufA[i] = bufB[i];
          bufB[i] = Math.floor(Math.random()*256);
          progress[i] -= 1;
        }
        const v = (bufA[i] + (bufB[i]-bufA[i]) * progress[i]) / 255;
        const r = (v*100 + 20) | 0;
        const g = (v*10) | 0;
        const b = (v*120 + 50) | 0;
        const p = i*4;
        d[p]=r; d[p+1]=g; d[p+2]=b; d[p+3]=255;
      }
      ctx.putImageData(img, 0, 0);
      if (magicAnimators.has(el)) anim.raf = requestAnimationFrame(frame);
    }
    anim.raf = requestAnimationFrame(frame);
  }

  function getFontSizeClass(value) {
    if (value < 1000) return "tile-size-small";    // 1-3 digits
    if (value < 10000) return "tile-size-medium";  // 4 digits
    if (value < 100000) return "tile-size-large";  // 5 digits
    return "tile-size-huge";                       // 6+ digits
  }

  function styleTileContent(el, cellData, isMagic, magicVal){
    el.classList.remove("block", "magic", "tile-size-small", "tile-size-medium", "tile-size-large", "tile-size-huge");
    el.style.background = "";
    el.style.color = "";

    if (isMagic){
      el.classList.add("magic");
      if (!el._magicCanvas){
        el.innerHTML = "";
        const canvas = document.createElement("canvas");
        canvas.width = 50;
        canvas.height = 50;
        el.appendChild(canvas);
        const label = document.createElement("span");
        label.className = "magic-label";
        el.appendChild(label);
        el._magicCanvas = canvas;
        el._magicLabel = label;
        startMagicAnimation(el, canvas);
      }
      el._magicLabel.textContent = String(magicVal);
      return;
    }

    if (el._magicCanvas){
      stopMagicAnimation(el);
      el._magicCanvas = null;
      el._magicLabel = null;
      el.innerHTML = "";
    }

    if (cellData.value === 1){
      el.classList.add("block");
      el.textContent = "VERY ANNOYING BLOCK!";
    } else {
      const idx = cellData.value >= 131072 ? MAX_TILE_IDX : Math.log2(cellData.value);
      el.style.background = TILE_BG[idx];
      el.style.color = TILE_FG[idx];
      el.textContent = String(cellData.value);
      
      // ADD THIS LINE
      el.classList.add(getFontSizeClass(cellData.value));
    }
  }

  function renderTiles(animate){
    const total = tilesLayerEl.clientWidth || tilesLayerEl.offsetWidth || 0;
    const cell = Math.max(0, (total - GAP*(SIZE-1)) / SIZE);

    const showAll = !state.mods.invisible || state.moveCount === 0 || state.gameOver;
    const visibleSet = new Set(state.spawnLocs);
    const newIds = new Set();

    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cellData = state.board[r][c];
        if (!cellData) continue;

        const loc = r*SIZE + c;
        const isMagic = state.mods.magician && state.magicCounter[r][c] !== 0;
        const magicVal = state.magicCounter[r][c];

        // Tiles hidden by the Invisible mod are simply not rendered at all,
        // so they are pixel-for-pixel identical to an empty cell behind them.
        // Magic blocks are always shown even under Invisible, since they're
        // a standing hazard the player needs to track, not something new
        // to memorize each move.
        if (!showAll && !isMagic && !visibleSet.has(loc)) continue;

        const x = c*(cell+GAP), y = r*(cell+GAP);

        let el = tileEls.get(cellData.id);
        const isNew = !el;
        if (isNew){
          el = document.createElement("div");
          el.className = "tile";
          tilesLayerEl.appendChild(el);
          tileEls.set(cellData.id, el);
        }

        // A tile can get re-rendered (moved/merged again) before a previous
        // render's delayed pulse-reset timeout has fired. If that stale
        // timeout is left pending, it will later stomp this tile's transform
        // back to an old position, visually overlapping whatever now
        // occupies that cell. Cancel it every time the tile is touched.
        if (el._pulseTimeout){
          clearTimeout(el._pulseTimeout);
          el._pulseTimeout = null;
        }

        el.style.width = cell + "px";
        el.style.height = cell + "px";
        styleTileContent(el, cellData, isMagic, magicVal);

        if (isNew){
          el.style.transition = "none";
          el.style.transform = `translate(${x}px, ${y}px) scale(${animate ? 0.3 : 1})`;
          el.style.opacity = animate ? "0" : "1";
          void el.offsetWidth; // force reflow so the "from" state is committed
          el.style.transition = animate ? "transform .16s ease-out, opacity .16s ease-out" : "none";
          el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
          el.style.opacity = "1";
        } else {
          const prevValue = Number(el.dataset.value);
          const valueChanged = !Number.isNaN(prevValue) && prevValue !== cellData.value;
          el.style.transition = animate ? "transform .18s ease, opacity .15s ease" : "none";
          if (valueChanged && animate){
            el.style.transform = `translate(${x}px, ${y}px) scale(1.18)`;
            el._pulseTimeout = setTimeout(() => {
              el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
              el._pulseTimeout = null;
            }, 130);
          } else {
            el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
          }
          el.style.opacity = "1";
        }

        el.dataset.value = String(cellData.value);
        newIds.add(cellData.id);
      }
    }

    // remove tiles that no longer exist (consumed by a merge, or now hidden)
    for (const [id, el] of Array.from(tileEls.entries())){
      if (newIds.has(id)) continue;
      tileEls.delete(id);
      stopMagicAnimation(el);
      if (el._pulseTimeout){
        clearTimeout(el._pulseTimeout);
        el._pulseTimeout = null;
      }
      if (animate){
        const curTransform = el.style.transform || "";
        el.style.transition = "opacity .15s ease, transform .15s ease";
        el.style.opacity = "0";
        el.style.transform = curTransform.replace(/scale\([^)]*\)/, "").trim() + " scale(0.6)";
        setTimeout(() => el.remove(), 160);
      } else {
        el.remove();
      }
    }
  }

  function render(){
    scoreValEl.textContent = state.score;
    bestValEl.textContent = state.best;
    movesValEl.textContent = state.moveCount;

    renderTiles(state.animationsEnabled);
    renderModChips();
    renderMagicLog();
    renderExtrovertLog();
    renderLockoutGlow();
  }

  function renderLockoutGlow(){
    // Duration is a CSS custom property so it can snap to 0 when
    // animations are disabled, matching the rest of the game's instant mode.
    boardWrapEl.style.setProperty(
      "--lockout-fade",
      state.animationsEnabled ? ".25s" : "0s"
    );

    const activeDir = (state.mods.lockout && state.lockedDir !== null) ? state.lockedDir : null;

    for (const dir in lockoutGlowEls){
      // Object keys from a computed-key literal are strings, so compare loosely.
      lockoutGlowEls[dir].classList.toggle("active", activeDir !== null && Number(dir) === activeDir);
    }
  }

  // Shows every currently-tracked biggest tile, its cell, and how many more
  // moves it can sit still before Extrovert teleports it home. Visible
  // whenever tracking is actually happening (mod on, or passively during
  // Chaos Mode), same condition processExtrovert() uses.
  function renderExtrovertLog(){
    const active = extrovertIsActive();
    extrovertLogEl.classList.toggle("show", active);
    if (!active) return;

    const entries = Object.values(state.extrovertTracker);
    if (entries.length === 0){
      extrovertLogListEl.innerHTML = `<p class="log-empty">Tracking the largest tile&hellip;</p>`;
      return;
    }

    // Inside renderExtrovertLog function
    extrovertLogListEl.innerHTML = entries
      .sort((a, b) => b.streak - a.streak)
      .map(entry => {
        const remaining = Math.max(0, EXTROVERT_STREAK_NEEDED - entry.streak);
        const rowLabel = entry.row + 1, colLabel = entry.col + 1;
        const countText = remaining === 0 ? "next move!" : `${remaining} move${remaining === 1 ? "" : "s"}`;
        
        // Add logic to get the correct colors based on the tile value
        const idx = entry.value >= 131072 ? MAX_TILE_IDX : Math.log2(entry.value);
        const style = `background: ${TILE_BG[idx]}; color: ${TILE_FG[idx]};`;

        return `<div class="extrovert-item" style="${style}">
                  <span class="ext-value">${entry.value}</span>
                  <span class="ext-loc">R${rowLabel}C${colLabel}</span>
                  <span class="ext-count">${countText}</span>
                </div>`;
      })
      .join("");
  }

  function renderMagicLog(){
    magicLogEl.classList.toggle("show", !!state.mods.magician);
    if (!state.mods.magician) return;

    if (state.magicLog.length === 0){
      magicLogListEl.innerHTML = `<p class="log-empty">No merges yet.</p>`;
      return;
    }

    // Map through all merge values from the turn and style them like tiles
    magicLogListEl.innerHTML = state.magicLog
    .sort((a, b) => b - a)
      .map(val => {
        // Because 'val' is now the input (e.g., 4), 
        // this index will point to the '4' tile's color/style
        const idx = val >= 131072 ? MAX_TILE_IDX : Math.log2(val);
        return `<span class="log-item" style="background: ${TILE_BG[idx]}; color: ${TILE_FG[idx]};">
                  ${val}
                </span>`;
      })
      .join("");
  }

  function renderModChips(){
    activeModsRow.innerHTML = "";
    if (state.chaosMode){
      const chaosChip = document.createElement("span");
      chaosChip.className = "mod-chip chaos-chip";
      chaosChip.textContent = "Chaos Mode";
      activeModsRow.appendChild(chaosChip);
    }
    MODS.forEach(m => {
      if (!state.mods[m.key]) return;
      const chip = document.createElement("span");
      chip.className = "mod-chip";
      chip.style.background = m.accent;
      chip.textContent = m.name;
      activeModsRow.appendChild(chip);
    });
  }

  function showOverlay(){
    overlayTitleEl.textContent = "Game Over";
    overlaySubEl.textContent = state.score > 0
      ? `No more moves left. Final score: ${state.score}.`
      : "No more moves left on the board.";
    overlayEl.classList.add("show");
  }
  function hideOverlay(){ overlayEl.classList.remove("show"); }

  function triggerLossFlash(){
    // Restart the animation even if a previous pulse is still fading out.
    lossFlashEl.classList.remove("pulse");
    void lossFlashEl.offsetWidth; // force reflow
    lossFlashEl.classList.add("pulse");
  }

  // reposition tiles (no animation) if the layout size changes
  window.addEventListener("resize", () => renderTiles(false));

  // ---------- input ----------
  const KEY_DIR = {
    ArrowLeft: DIR.LEFT,
    ArrowRight: DIR.RIGHT,
    ArrowUp: DIR.UP,
    ArrowDown: DIR.DOWN,

    a: DIR.LEFT, A: DIR.LEFT,
    d: DIR.RIGHT, D: DIR.RIGHT,
    w: DIR.UP, W: DIR.UP,
    s: DIR.DOWN, S: DIR.DOWN,

    h: DIR.LEFT, H: DIR.LEFT,
    j: DIR.DOWN, J: DIR.DOWN,
    k: DIR.UP, K: DIR.UP,
    l: DIR.RIGHT, L: DIR.RIGHT,

    Numpad4: DIR.LEFT,
    Numpad6: DIR.RIGHT,
    Numpad8: DIR.UP,
    Numpad2: DIR.DOWN,
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("show")){
      closeModal();
      return;
    }
    if (e.key in KEY_DIR){
      e.preventDefault();
      handleMove(KEY_DIR[e.key]);
    }
  });

  const boardWrap = document.getElementById("boardWrap");
  let touchStartX = 0, touchStartY = 0, touching = false;

  boardWrap.addEventListener("touchstart", (e) => {
    if (state.tapControlsEnabled) return;
    touching = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, {passive:true});

  boardWrap.addEventListener("touchend", (e) => {
    if (state.tapControlsEnabled) return;
    if (!touching) return;
    touching = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (Math.max(absX, absY) < 24) return;
    if (absX > absY){
      handleMove(dx > 0 ? DIR.RIGHT : DIR.LEFT);
    } else {
      handleMove(dy > 0 ? DIR.DOWN : DIR.UP);
    }
  }, {passive:true});

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("show")){
      closeModal();
      return;
    }
  
    // Add this block to handle 'R' for restart
    if (e.key === "r" || e.key === "R") {
      newGame();
      return;
    }
  });

  document.getElementById("newGameBtn").addEventListener("click", newGame);
  document.getElementById("overlayRestart").addEventListener("click", newGame);
  overlayCloseBtn.addEventListener("click", hideOverlay);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) hideOverlay();
  });
  document.getElementById("resetModsBtn").addEventListener("click", () => {
    state.chaosMode = false;
    state.chaosActiveMod = null;
    MODS.forEach(m => state.mods[m.key] = false);
    syncModCards();
    loadBestScore();
    newGame();
  });

  // ---------- settings modal ----------
  const settingsBtn = document.getElementById("settingsBtn");
  const modalClose = document.getElementById("modalClose");

  function openModal(){
    modalOverlay.classList.add("show");
    chaosKeyBuffer = "";
    syncModCards();
  }
  function closeModal(){ modalOverlay.classList.remove("show"); }

  settingsBtn.addEventListener("click", openModal);
  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ---------- chaos mode cheat code ----------
  // While the Mods tab of the menu is open, typing the letters "chaos" in
  // sequence toggles Chaos Mode on/off, cheat-code style.
  let chaosKeyBuffer = "";

  function isModsTabOpen(){
    const modsPanel = document.querySelector('.tab-panel[data-panel="mods"]');
    return modalOverlay.classList.contains("show") && modsPanel && !modsPanel.hidden;
  }

  window.addEventListener("keydown", (e) => {
    if (!isModsTabOpen()){
      chaosKeyBuffer = "";
      return;
    }
    if (e.key.length === 1 && /[a-z]/i.test(e.key)){
      chaosKeyBuffer = (chaosKeyBuffer + e.key.toLowerCase()).slice(-5);
      if (chaosKeyBuffer === "chaos"){
        chaosKeyBuffer = "";
        setChaosMode(!state.chaosMode);
      }
    } else {
      chaosKeyBuffer = "";
    }
  });

  // ---------- chaos mode title tap toggle ----------
  // Tapping/clicking the "2048" title 5 times within 2 seconds toggles
  // Chaos Mode, same effect as the "chaos" keyboard cheat code above.
  // Uses a plain "click" listener (fires for touch taps and mouse clicks
  // alike) rather than the Pointer Events API.
  const titleH1 = document.getElementById("titleH1");
  let titleTapCount = 0;
  let titleTapResetTimer = null;

  titleH1.addEventListener("click", () => {
    titleTapCount += 1;

    clearTimeout(titleTapResetTimer);
    titleTapResetTimer = setTimeout(() => {
      titleTapCount = 0;
    }, 2000);

    if (titleTapCount >= 5){
      titleTapCount = 0;
      clearTimeout(titleTapResetTimer);
      setChaosMode(!state.chaosMode);
    }
  });

  // ---------- modal tabs (Mods / Settings) ----------
  const modalTabsEl = document.getElementById("modalTabs");
  const tabPanels = document.querySelectorAll(".tab-panel");

  modalTabsEl.querySelectorAll(".modal-tab-btn").forEach(tabBtn => {
    tabBtn.addEventListener("click", () => {
      const target = tabBtn.dataset.tab;
      modalTabsEl.querySelectorAll(".modal-tab-btn").forEach(b => {
        b.classList.toggle("active", b === tabBtn);
      });
      tabPanels.forEach(panel => {
        panel.hidden = panel.dataset.panel !== target;
      });
    });
  });

  // ---------- animation setting ----------
  const animSegment = document.getElementById("animSegment");

  function syncAnimButtons(){
    animSegment.querySelectorAll(".seg-btn").forEach(btn => {
      const isOn = btn.dataset.val === "on";
      btn.classList.toggle("active", isOn === state.animationsEnabled);
    });
  }

  animSegment.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.animationsEnabled = btn.dataset.val === "on";
      syncAnimButtons();
      try { localStorage.setItem("2048modlab_anim", btn.dataset.val); } catch(e) {}
    });
  });

  // ---------- theme setting ----------
  const themeSegment = document.getElementById("themeSegment");

  function syncThemeButtons(){
    themeSegment.querySelectorAll(".seg-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.val === state.theme);
    });
  }

  themeSegment.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.theme = btn.dataset.val;
      syncThemeButtons();
      applyTheme();
      try { localStorage.setItem("2048modlab_theme", state.theme); } catch(e) {}
    });
  });

  // ---------- touch controls setting ----------
  const tapControlsSegment = document.getElementById("tapControlsSegment");

  function syncTapControlsButtons(){
    tapControlsSegment.querySelectorAll(".seg-btn").forEach(btn => {
      const isOn = btn.dataset.val === "on";
      btn.classList.toggle("active", isOn === state.tapControlsEnabled);
    });
  }

  function syncTapZones(){
    for (const dir in tapZoneEls){
      tapZoneEls[dir].classList.toggle("enabled", state.tapControlsEnabled);
    }
  }

  tapControlsSegment.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.tapControlsEnabled = btn.dataset.val === "on";
      syncTapControlsButtons();
      syncTapZones();
      try { localStorage.setItem("2048modlab_tapcontrols", btn.dataset.val); } catch(e) {}
    });
  });

  // Tapping/clicking an edge zone moves in that direction, same as a
  // keypress or swipe. Use pointerdown (not click) so the move fires the
  // instant the press begins rather than waiting for release. Object keys
  // from the computed-key literal above are strings, so Number() them
  // back into DIR values.
  for (const dir in tapZoneEls){
    tapZoneEls[dir].addEventListener("pointerdown", (e) => {
      if (!state.tapControlsEnabled) return;
      e.preventDefault();
      handleMove(Number(dir));
    });
  }

  // ---------- mods panel ----------
  // Each mod is a square button showing a two-letter abbreviation.
  // Clicking toggles the mod on/off; active mods tilt 10deg clockwise
  // and brighten so it's clear at a glance which are selected.
  const modListEl = document.getElementById("modList");
  const modDescPanelEl = document.getElementById("modDescPanel");

  MODS.forEach(m => {
    const square = document.createElement("button");
    square.type = "button";
    square.className = "mod-square";
    square.style.setProperty("--accent", m.accent);
    square.dataset.key = m.key;
    square.setAttribute("aria-label", m.name);
    square.innerHTML = `<span class="abbr">${m.abbr}</span>`;
    modListEl.appendChild(square);
  });

  modListEl.querySelectorAll(".mod-square").forEach(square => {
    square.addEventListener("click", () => {
      if (state.chaosMode) return; // mods are picked automatically while Chaos Mode is running
      const key = square.dataset.key;
      state.mods[key] = !state.mods[key];
      syncModCards();
      loadBestScore();
      newGame();
    });
  });

  function syncModCards(){
    MODS.forEach(m => {
      const square = modListEl.querySelector(`.mod-square[data-key="${m.key}"]`);
      square.classList.toggle("active", state.mods[m.key]);
      square.classList.toggle("chaos-locked", state.chaosMode);
    });
    renderModDescPanel();
  }

  function renderModDescPanel(){
    if (state.chaosMode){
      const activeMod = MODS.find(m => m.key === state.chaosActiveMod);
      modDescPanelEl.innerHTML = `<div class="mod-desc-item chaos-desc"><b>Chaos Mode:</b> mods shuffle themselves — a 10% chance per move to swap to a different random mod. Type "chaos" again to turn it off.<br>` +
        (activeMod ? ` Currently active: <b>${activeMod.name}</b> &mdash; ${activeMod.desc}` : "") +
        `</div>`;
      return;
    }
    const active = MODS.filter(m => state.mods[m.key]);
    if (active.length === 0){
      modDescPanelEl.innerHTML = `<p class="mod-desc-empty">Select a mod to see its description.</p>`;
      return;
    }
    modDescPanelEl.innerHTML = active
      .map(m => `<div class="mod-desc-item"><b>${m.name}:</b> ${m.desc}</div>`)
      .join("");
  }

  // ---------- boot ----------
  syncModCards();
  syncAnimButtons();
  syncThemeButtons();
  syncTapControlsButtons();
  syncTapZones();
  loadBestScore();
  newGame();
})();
