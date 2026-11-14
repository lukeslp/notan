# Notan

A black-and-white nonogram for the browser. Fill squares so every row and column matches its
numbers. When you finish, a picture appears.

Play it at <https://playnotan.com/>.

## What's in it

- 53 levels, from a 2×2 square up to 15×15. Every level has exactly one solution, and you can
  reach it line by line without guessing.
- New Game+: 20 harder, asymmetric pictures that unlock after level 53.
- Quick play: random boards at 5, 8, 10, 12 or 15 squares a side. The generator keeps only boards
  with one solution that can be solved line by line, and the same seed always gives the same board.
- How to play shows a few small examples; the first levels teach the rest.
- Hold a row's or column's numbers to lock a finished line. After a Quick play board, Share blank
  sends the same unsolved board to a friend.
- Settings for zoom, a light or dark theme (or the system's), and resetting a level or the game.
  Holding the empty background opens Settings.
- A hint, in Settings and at the bottom of How to play, for when you are stuck. It rings one wrong
  square, or a square you can work out and the numbers that settle it.
- Progress saves in the browser.

## Run it

Notan is plain HTML, CSS and JavaScript, with no build step and no dependencies. Serve the folder
with any static file server, for example:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Files

| File | What it does |
|---|---|
| `index.html` | The page, its dialogs and How to play |
| `notan.js` | The game: board, input, saves, Settings, Quick play |
| `engine.js` | Clues, the line solver, solution counting and the random board generator |
| `levels.js` | The 53 level pictures, drawn as rows of `#` and `.` |
| `plus-levels.js` | The 20 New Game+ pictures, unlocked after level 53 |
| `notan.css` | The look, in light and dark |
| `fonts/` | IBM Plex Sans and IBM Plex Mono |

## Tests

```
node test-levels.js
```

This checks that every level has one solution the line solver can finish, that the levels get
harder gradually, and that the generator only makes unique, line-solvable boards.

```
npm i -D playwright-core && npx playwright install chromium
node test-ui.cjs
```

This plays the page in Chromium at phone and desktop sizes, in light and dark. Set `PLAYWRIGHT` or
`CHROME` to use a different copy of either.

## Saves

Progress is stored in `localStorage` under the key `ink.v1`. The game was called Ink until
October 2026, and the key stayed the same so nobody lost their progress.

## Analytics

`index.html` loads a GoatCounter script that counts visits on my own stats server. Remove that
`<script>` line if you host a copy.

## Nonogram Primitives

`primitives/` holds Nonogram Primitives, user interface experiments dressed up as games, built on
Notan's engine: a nonogram that zooms out each time a board is solved, in six modes (Merge, Pixel,
Hole, Ring, Patch, Mines). Open `primitives/index.html` through a local static server.
`primitives/README.md` describes the modes, the generator and the tests. Like the rest of this repo,
it is synced from game-riffs (`notan-zoom-lab/`) by `tools/publish-notan-source.sh`, so change it
there.

## Native app

`app/` wraps this game for iPhone, iPad and Android as an offline Capacitor
app, on the pattern of Hexsweeper's. See `app/README.md`. The game-riffs
sync script excludes `/app`, so syncs leave it alone.

## License

MIT, © 2026 Luke Steuber. See `LICENSE`. The IBM Plex fonts are under the SIL Open Font License
1.1; see `fonts/OFL.txt`.
