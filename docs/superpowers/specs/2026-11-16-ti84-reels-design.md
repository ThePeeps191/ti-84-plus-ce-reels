# TI-84 Plus CE Reels — Design

Date: 2026-11-16 · Status: approved in chat (the user delegated the remaining design choices to Claude)

## Goal

Watch your live Instagram Reels feed on a TI-84 Plus CE that is tethered to a Windows laptop over USB. The calculator's keys scroll, pause and like. Blurry is fine, as long as it's recognizable.

## Verified constraints (spike, 2026-11-16)

- The calculator runs OS 5.8.0, and native code needs arTIfiCE v2.1 (installed, `prgmA`). You launch native programs from the arTIfiCE shell with a physical ENTER.
- The CE C toolchain v15.0 and clibs v15.0 are installed on the calculator.
- `srldrvce` in device mode enumerates as USB CDC-ACM `16C0:05E1`. Windows binds `usbser` → COM port; no driver needed.
- Measured throughput is ~200 KiB/s (4 KiB srl buffer, `srl_Read` into VRAM).
- Laptop: a dedicated Chrome profile (`%LOCALAPPDATA%\ti84-reels\chrome-profile`), logged in by the user. Chrome is launched normally with `--remote-debugging-port` and driven by `playwright-core` through `connectOverCDP`, which avoids the automation flags. Drawing Instagram's `<video>` (an MSE blob) into a canvas and calling `getImageData` works and takes ~13 ms per 135×240 grab.

## User decisions

| Topic | Decision |
|---|---|
| Orientation | Upright. Video in the middle, side panels on both sides |
| Video | 16-color (4bpp) by default for smoothness; [alpha] toggles 256-color (8bpp) |
| Controls | ▲ prev, ▼ next, [enter] pause/play, [2nd] like/unlike, [mode] repost/undo (added later), [alpha] color mode, [clear] quit |
| Side info | Username, like + comment + repost counts (with liked/reposted highlight), key hints. No caption |
| Laptop window | Visible phone-sized Chrome window; may be covered (occlusion throttling disabled). Sound plays from it |
| Startup | `npm start` (or a desktop shortcut) on the laptop; REELS launched from the arTIfiCE shell on the calculator; either side may start first and either side reconnects |

## Architecture

The calculator is a dumb framebuffer plus a keypad. The laptop renders all pixels, including the UI panels.

```
Chrome (instagram.com/reels) ──CDP── host (Node) ──USB CDC serial── REELS.8xp (calc)
   <video> → canvas 136×240           capture → quantize → pack       VRAM blit + palette
   actions ← page.evaluate            key → action                    keypad scan → KEY msg
```

Screen layout (320×240): left panel x 0–91 (92 px), video x 92–227 (136×240), right panel x 228–319 (92 px). All x and widths are even, so 4bpp bytes align.

### Calculator program `calc/` (REELS.8xp, C, CEdev)

- `main.c`: initializes the screen and USB, then runs the main loop: `usb_HandleEvents`, protocol pump, keypad edge detection. [clear] sends BYE and quits cleanly (`usb_Cleanup`, `gfx_End`).
- `link.c`: owns the srldrvce device, including the open/close lifecycle on USB events, plus non-blocking read/write helpers.
- `proto.c`: a streaming parser for host messages. Payloads go into a receive buffer in the unused second half of VRAM (`lcd_Ram + 76800`), then get applied atomically: palette entries first, then the rectangle blit.
- `display.c`: LCD bpp switching (4/8 via `lcd_Control` bits 1–3), palette writes, rectangle blits, and a "Waiting for laptop…" status screen (8bpp, graphx text).
- If the host stops talking, the program keeps showing the last image. If the USB disconnects, it returns to the status screen.

### Wire protocol (both directions)

Frame: `0xA5, type u8, len u24 LE, payload[len]`.

| Dir | Type | Payload |
|---|---|---|
| H→C | `0x01 HELLO` | `proto_version u8` |
| H→C | `0x10 MODE` | `bpp u8` (4 or 8). Clears the screen to index 0 |
| H→C | `0x12 BLIT` | `x u16, y u8, w u16, h u8, pal_start u8, pal_count u8, pal[pal_count] u16 (1555), pixels` (rows packed at the current bpp; 4bpp puts the left pixel in the low nibble) |
| H→C | `0x20 DUMP` | — (debug: request a framebuffer readback) |
| H→C | `0x30 QUIT` | — (calc exits back to the shell) |
| C→H | `0x81 HELLO` | `proto_version u8, bpp u8` |
| C→H | `0x82 ACK` | `seq u8` (one per applied BLIT; the host keeps ≤ 2 BLITs in flight) |
| C→H | `0x83 KEY` | `scan u8`: keypad scan code `group*8+bit` (keypadc) for any key except [clear] (protocol v2; v1 sent 1–5) |
| C→H | `0x84 BYE` | — |
| C→H | `0x85 DUMP` | `bpp u8, palette[256] u16, vram[bpp*320*240/8]` |

Palette budget: 4bpp uses indices 0–3 for the UI (black, white, gray, red) and 4–15 for the video (12 adaptive colors). 8bpp uses 0–15 for the UI and 16–255 for the video (240 adaptive colors).

### Host app `host/` (Node.js, playwright-core, serialport)

- `chrome.js`: reuses Chrome on port 9333 if it's running. Otherwise it launches Chrome with the dedicated profile and flags (`--autoplay-policy=no-user-gesture-required`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`), connects over CDP, and returns the Reels page.
- `instagram.js`: finds the current reel (the most visible `<video>`) and handles next/prev, pause/play, like/unlike, unmuting, and best-effort metadata (username, like count, comment count, liked state). It detects the logged-out state.
- `capture.js`: the in-page canvas grab of the current video, cover-cropped to 136×240 and returned as base64 RGBA.
- `quantize.js`: an adaptive palette (median cut, refined by a couple of k-means passes seeded from the previous frame's palette for temporal stability) plus ordered (Bayer) dithering, which avoids FS shimmer.
- `pack.js`: index → 4bpp/8bpp byte packing, and RGB888 → 1555.
- `ui.js`: renders the side panels with a canvas in the browser (text and a heart shape), then maps them to the UI palette. It's only resent when the content changes.
- `protocol.js`: the message encoder and a streaming decoder.
- `calc-link.js`: finds the COM port (VID 16C0, PID 05E1), handles the HELLO handshake, the send queue with ACK flow control, key events, and reconnects.
- `index.js`: wires everything: frame pump (latest frame wins, capped at ~15 fps), key → action → panel refresh, a metadata poll every ~1 s, and status logging.

### Tools `tools/`

- `dusb.js`: a minimal TI DUSB client from the spike (screenshot, remote keys, silent var send, dirlist).
- `deploy.js`: builds `calc/`, then sends REELS.8xp (and clibs if missing) to the calculator over DUSB. It waits while the arTIfiCE shell is open.
- `screenshot.js`: a DUSB screenshot when the calc is in the OS, and a protocol `DUMP` when REELS is running.

## Error handling

- Calc: USB disconnect → status screen, keep waiting; [clear] always quits. Malformed frame (bad magic) → resync by scanning for `0xA5`.
- Host: COM port vanishes → reconnect loop. Chrome closed → relaunch. Logged out → log it, and show "Log in on laptop" in the calc panel. Metadata not found → blank fields. The video never stops for metadata.

## Testing

- Host unit tests (`node:test`): protocol round-trip and streaming decode, pack 4/8bpp, quantize (color count, index range, determinism), layout constants.
- Hardware checks: `DUMP` readback rendered to PNG to verify calc drawing; DUSB screenshots for the OS-side state; an end-to-end run measuring fps.
- Calc-side iterations need physical keys ([mode] to leave the shell, [enter] to launch), so calc changes are batched and the host is restartable without touching the calc.

## Later / optional

- Faster transport: a bigger srl buffer, or usbdrvce bulk transfers DMA'd straight into VRAM.
