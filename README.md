# TI-84 Plus CE Reels

Watch your Instagram Reels feed on a TI-84 Plus CE that is plugged into a Windows laptop over USB, and scroll it with the calculator's arrow keys.

```
Chrome (instagram.com/reels) ──CDP── laptop app (Node) ──USB serial── REELS.8xp on the calculator
```

The laptop does the work. A dedicated Chrome window plays the reel, and that's where the sound comes from. The app grabs each video frame, reduces it to 16 or 256 colors, and streams it to the calculator. The calculator program shows the pixels and sends key presses back.

| Key | Action |
|---|---|
| ▲ / ▼ | previous / next reel |
| [enter] | pause / play |
| [2nd] | like / unlike (on your real account) |
| [mode] | repost / undo repost (on your real account) |
| [alpha] | switch 16 colors (~12 fps) ↔ 256 colors (~5 fps) |
| [clear] | quit |

The screen shows the username on the left, the reel (136×240) in the middle, and likes, comments, reposts and key hints on the right.

## Daily use

1. Plug the calculator into the laptop with the USB cable.
2. On the laptop, double-click **TI-84 Reels** on the desktop, or run `npm start` in `host/`. A phone-sized Chrome window opens on Instagram Reels. You can cover it with other windows, but don't minimize it.
3. On the calculator, press **[prgm]**, run **A** (the arTIfiCE shell), select **REELS** and press **[enter]**.

You can start either side first, and either side reconnects if you restart it. To stop, press **[clear]** on the calculator (you return to the arTIfiCE shell; press **[mode]** to leave it) and close the console window on the laptop.

## One-time setup (already done on this laptop)

1. **USB driver:** Windows' code-integrity policy blocks TI's own driver (`tiehdusb.sys`, Device Manager error 39). Use [Zadig](https://zadig.akeo.ie) to bind the calculator (`USB ID 0451 E008`) to **WinUSB**. TI Connect CE will no longer see the calculator; you can undo this from Device Manager. When REELS is running, the calculator appears as a separate USB serial device (`16C0:05E1`) that Windows drives automatically.
2. **Native programs:** OS 5.5+ blocks C/assembly programs. This calculator runs OS 5.8.0 and uses [arTIfiCE v2.1](https://yvantt.github.io/arTIfiCE) (`prgmA`), which doesn't modify the OS. **Don't update the calculator OS**, because newer versions break arTIfiCE and TI blocks downgrades.
3. **Libraries:** the [CE C libraries](https://github.com/CE-Programming/libraries/releases) (`clibs.8xg`) must be on the calculator.
4. **Instagram login:** the app uses its own Chrome profile in `%LOCALAPPDATA%\ti84-reels\chrome-profile`. Log in once in the window it opens. Your everyday Chrome is never touched.
5. **Node.js 20+:** run `npm install` in `host/`.

## Development

- **Calculator program** (`calc/`, C): needs the [CE C toolchain](https://github.com/CE-Programming/toolchain/releases) (v15.0 here, in `%LOCALAPPDATA%\CEdev`, or set `CEDEV`).
- **Build + install:** `npm run deploy` in `host/`. It builds `calc/`, waits until the calculator accepts transfers (press [mode] if the arTIfiCE shell is open), sends `REELS.8xp`, and opens the shell by remote key presses. Use `npm run deploy -- --clibs path\to\clibs.8xg` to install the libraries too.
- **Tests:** `npm test` in `host/`. These are unit tests for the protocol, the color pipeline and the layout.
- **Hardware tools** (`host/tools/`):
  - `linktest.js` measures fps at both color depths and saves a framebuffer readback from the calculator.
  - `keylisten.js` logs key presses.
  - `preview.js` renders what the calculator would show.
  - `igtest.js` exercises the Instagram controls.
  - `dusb.js` is a minimal TI link-protocol client for screenshots, remote keys and file transfer while the calculator is at the OS.
- Native programs read the keypad hardware directly, so remote key presses only work on OS screens. Launching REELS from the shell always needs a real [enter].
- Design and plan: `docs/superpowers/specs/2026-11-16-ti84-reels-design.md`, `docs/superpowers/plans/2026-11-16-ti84-reels.md`.

### Wire protocol (summary)

Each frame is `0xA5, type, len (u24 LE), payload`. The host sends `HELLO`, `MODE(bpp)`, `BLIT(x,y,w,h,palette slice,pixels)`, `DUMP` and `QUIT`. The calculator sends `HELLO`, `ACK` (one per BLIT, at most 2 in flight), `KEY` (a keypad scan code, group×8+bit, for any key except [clear], so new controls only need laptop changes), `BYE` and `DUMP`. See `host/src/protocol.js` and `calc/src/proto.h`.

## Notes

- Instagram's web layout changes over time. The page logic lives in `host/src/page-helpers.js` and uses aria-labels rather than class names. If the counts or the like button stop working, start there.
- Automating your own logged-in browser for personal viewing is low-risk, but it is still automation of Instagram's site. Use it at your own discretion.
