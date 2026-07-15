(function(global){
  "use strict";

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
  //
  // Split out of script.js into its own file. Because it needs a handful
  // of things from the main game (the shared board/mods state, the SIZE
  // constant, the live spawn-probability function, and a couple of small
  // helpers), it's exposed as a factory -- createAdversarialEngine(deps) --
  // rather than a bare IIFE. script.js calls this once at startup, handing
  // in those dependencies, and gets back an { expertSpawn } object to use
  // exactly as before.
  function createAdversarialEngine(deps){
    const {
      SIZE,             // board dimension (4)
      state,            // shared mutable game state (state.mods, state.board)
      currentSpawnProbs,// () => { values, probs } for the live spawn distribution
      shyFilterCells,   // (cells, direction) => cells allowed under Shy
      emptyCells,       // () => list of empty [r,c] cells on the real board
      recordSpawnStat,  // (val) => tallies a real tile spawn for stats
      consumeTileId     // () => returns the next tile id and increments the counter
    } = deps;

    const evalCache = new Map();

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

    // Sloth-aware row slide: every tile advances (or merges into its left
    // neighbor) by at most one cell, mirroring moveTileLeft's single
    // do-while pass in the real game instead of sliding the whole row flush.
    // Keeping this in lockstep with the real mechanic matters because
    // Expert's lookahead (simulatePlayerBest, countFutureMerges, the
    // expectiminimax search itself) all replay hypothetical player moves
    // through moveLeftFlat -- if that still assumed a full slide while
    // Sloth capped real moves at one cell, Expert would be judging "worst
    // spawn" against futures the player could never actually reach.
    function slideRowSloth(a, b, c, d) {
      const input = [a, b, c, d];
      const row = [0, 0, 0, 0];

      let write = 0;
      let last = 0;
      let gainedScore = 0;

      for (let i = 0; i < SIZE; i++) {
          const tile = input[i];
          if (!tile) continue;

          if (!last) {
              last = tile;
          } else if (last === tile) {
              row[write++] = last * 2;
              gainedScore += last * 2;
              last = 0;
          } else {
              row[write++] = last;
              last = tile;
          }
      }

      if (last) {
          row[write++] = last;
      }

      return {
          row,
          gainedScore
      };
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
        const { row, score } = state.mods.sloth
          ? slideRowSloth(b[offset], b[offset+1], b[offset+2], b[offset+3])
          : slideRow(b[offset], b[offset+1], b[offset+2], b[offset+3]);
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
      const profile = {
        block: bigTileBlockScore(b, r, c),
        escape2: cornerEscapeScore(b, r, c, 2),
        escape4: cornerEscapeScore(b, r, c, 4)
      };
      // Only computed when Greed is active (8's can spawn), so Expert's
      // ranking/search behavior is unchanged when Greed is off.
      if (state.mods.greed) profile.escape8 = cornerEscapeScore(b, r, c, 8);
      return profile;
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
      sc += (val === 2 ? p.escape2 : val === 4 ? p.escape4 : (p.escape8 || 0));
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

      // Uses the live spawn probabilities (currentSpawnProbs, defined
      // outside this module) so this "what happens next" simulation
      // matches whatever can actually spawn -- including Greed's 8's,
      // when Greed is active alongside Expert.
      const { values: spawnVals, probs: spawnProbs } = currentSpawnProbs();

      let worstExpected = Infinity;
      for (const idx of cells){
        let expected = 0;
        for (let i=0;i<spawnVals.length;i++){
          const val = spawnVals[i];
          const bv = cloneFlat(b); bv[idx[0]*SIZE+idx[1]] = val;
          const ev = (depth <= 1) ? evaluateBoardForPlayer(bv) : expectiminimaxMax(bv, depth-1, worstExpected);
          expected += spawnProbs[i]*ev;
        }

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
      const disruption = p.block + p.escape2 + p.escape4 + (p.escape8 || 0);

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

      // Greed lets 8's spawn too, so once it's active Expert's adversarial
      // choice also considers placing an 8, not just 2's and 4's.
      const candidateVals = state.mods.greed ? [2,4,8] : [2,4];

      // Candidates are already ranked best-first (most disruptive cell
      // heuristically first), so if the time budget runs out partway
      // through, whatever's been evaluated so far is still a good pick --
      // we just stop looking for something even better instead of
      // leaving the move undecided.
      for (const [r,c] of candidates){
        const profile = profiles.get(r*SIZE+c);
        for (const val of candidateVals){
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

    const Expert = {
      pickSpawn: function(flatBoard){ return deviousSpawn(flatBoard); }
    };

    // Converts the live {id,value} board into the flat number array the
    // Expert engine works with, runs its adversarial search, and places the
    // result as a real tile. Blocked's obstacle sentinel (1) and Magician's
    // TV-static sentinel (-1) are remapped to an ordinary positive number
    // first so they read as "occupied" to the engine instead of tripping up
    // its math (it takes log2() of tile values, which breaks on negatives).
    function expertSpawn(direction){
      const cells = shyFilterCells(emptyCells(), direction);
      if (cells.length === 0) return null;

      const flat = new Array(SIZE*SIZE).fill(0);
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE;c++){
          const cell = state.board[r][c];
          flat[r*SIZE+c] = cell ? (cell.value > 0 ? cell.value : 2) : 0;
        }
      }

      // If Shy narrowed things down, mask every empty cell that isn't in the
      // allowed set as temporarily occupied so the adversarial search only
      // ever considers the legal side of the board.
      if (state.mods.shy){
        const allowed = new Set(cells.map(([r,c]) => r*SIZE+c));
        for (let r=0;r<SIZE;r++){
          for (let c=0;c<SIZE;c++){
            const idx = r*SIZE+c;
            if (flat[idx] === 0 && !allowed.has(idx)) flat[idx] = 1; // sentinel: not really a tile, just "unavailable"
          }
        }
      }

      const chosen = Expert.pickSpawn(flat);
      if (!chosen) return null;

      state.board[chosen.r][chosen.c] = { id: consumeTileId(), value: chosen.val };
      recordSpawnStat(chosen.val);
      return chosen.r*SIZE + chosen.c;
    }

    return { expertSpawn };
  }

  global.createAdversarialEngine = createAdversarialEngine;
})(typeof window !== "undefined" ? window : this);
