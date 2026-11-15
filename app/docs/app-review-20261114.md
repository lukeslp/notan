# App Review: Notan 1.0 (1.0.0 build 3), 14 November 2026

## What Apple said

Submitted 2026-11-14 11:27 PST (submission `95e1d44a-c7f2-4b63-9fad-9d1b1bde6d81`).
Rejected 16:30 PST under **Guideline 2.1, Information Needed, New App
Submission**. This isn't a crash or a code defect. Apple wants the following
in the App Review Information **Notes** field before it will review the build:

1. A screen recording made on a physical device running the latest OS. It
   must start at launch and show the typical flow. (There are no accounts,
   user-generated content or paid features, so none of those parts apply.)
2. What the app is for, who it's for, and the value it gives.
3. How to reach the main features, plus any login or sample files.
4. The external services the app uses.
5. Regional differences, or confirmation that there are none.
6. Documents for regulated industries or protected third-party material.

The Notes field was empty on this submission (`appStoreReviewDetail.notes` was
`None`), which is the likely trigger.

## Cause in the repo

There's no code cause. The build itself is fine as far as Apple has said. The
fix is metadata plus one recording.

## Proposed fix

1. **Recording (Luke, on a device).** Use the iPhone or the iPad mini, on the
   newest iOS it can take. Install 1.0.0 (3) from TestFlight, where it's in
   internal testing, and record with Control Center's Screen Recording. Keep
   it to about 60–90 seconds:
   - cold launch from the Home Screen (level 1 opens on the board)
   - tap squares, drag to fill a line, double-tap to mark a square empty, Undo
   - solve a small level until the picture appears
   - open How to play, Levels and Settings (theme, Zoom)
   - Hint once
   - Quick play: pick a size, then Share blank to show the system share sheet
   - close the app and reopen it to show that progress was kept
2. **Notes (I can set this with the API once Luke says yes).** Paste the text
   below into App Review Information, Notes.
3. **Attach the recording** to the reply in the Resolution Center. The Notes
   field is plain text, so it can't carry a video. If Luke would rather link
   a hosted copy, the link goes on the first line of the Notes. Hosting it is
   Luke's call.
4. **Same build.** Resubmit 1.0.0 (3). No new upload is needed.
5. Optional, while the version is open: replace the two stale solved shots
   (6.7" #2 and iPad #2 show the finished picture black). Apple didn't flag
   them, and memory says to fix them in the first update, so leave them unless
   Luke wants them now.

## Draft: App Review Notes

```
Screen recording: attached to our reply in the Resolution Center (iPhone, latest iOS, starting at launch).

1. Purpose and audience
Notan is a nonogram (picture logic) puzzle game in black and white, for anyone who enjoys logic puzzles, from beginners to experienced solvers. The numbers beside each row and column give the runs of filled squares; solving them line by line reveals a small picture. It offers a calm, offline puzzle with no ads, accounts or tracking. Every level has exactly one solution that can be reached without guessing.

2. How to use it
No login, setup or sample files. The app opens straight onto level 1.
- Tap a square to fill or clear it; drag to fill a line; double-tap or hold to mark a square empty. Undo reverses the last move.
- Hint rings one wrong square, or a square that can be worked out and the numbers that settle it.
- Levels: 53 levels from 2x2 to 15x15; New Game+ (20 harder pictures) unlocks after level 53.
- Quick play: random boards at 5, 8, 10, 12 or 15 squares a side.
- How to play walks through small examples. Settings has light/dark theme and Zoom.
- Progress is saved on the device; closing and reopening resumes the puzzle.

3. External services
None. The app is fully offline: the game is bundled HTML/CSS/JS in a WebView with a bundle-only Content-Security-Policy, no analytics, no network requests, no third-party SDKs, no sign-in, no payments. The only links leave the app: one link to the developer's website at the foot of How to play opens Safari, and Quick play's "Share blank" passes a playnotan.com link to the system share sheet.

4. Regions
The app works the same in every region. It is English only and has no region-specific content or features.

5. Regulated industries / third-party material
Not applicable. The puzzles and pictures are original. The only third-party material is the IBM Plex Sans and Plex Mono fonts, used under the SIL Open Font License 1.1 (license included in the app).
```

## Draft: Resolution Center reply

```
Hello,

Thank you for the review. I have added the requested information to the App Review Information Notes field and attached a screen recording of Notan 1.0 (build 3) made on a physical iPhone running the latest iOS. The recording starts at launch and shows the full flow: playing and solving a level, hints, the level list, How to play, Settings, Quick play and resuming saved progress.

In short: Notan is an offline nonogram puzzle game. It has no accounts, purchases, ads, analytics, user-generated content or external services, and it works the same in every region.

Please let me know if you need anything else.
```

## Needs Luke's yes (none of it done)

- Make and attach the recording.
- Set the Notes text above on version 1.0 (`6ec93027-20ac-43f5-b85e-b03b2021bea0`).
- Send the reply and resubmit 1.0.0 (3).
