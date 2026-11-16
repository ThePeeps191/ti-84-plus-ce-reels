/*
 * REELS - shows Instagram Reels streamed from the laptop host app over USB.
 * The calculator is a dumb framebuffer + keypad; see docs/superpowers/specs.
 */
#include "display.h"
#include "link.h"
#include "proto.h"

#include <keypadc.h>
#include <stdbool.h>
#include <stdint.h>
#include <time.h>

#define KEY_SCAN_INTERVAL (CLOCKS_PER_SEC / 50) /* 20 ms */

enum { ST_NONE, ST_NO_USB, ST_NO_HOST, ST_STREAMING };

/* Key presses are reported as keypad scan codes (group * 8 + bit, see keypadc.h),
 * so the laptop decides what every key does without changing this program. */
#define SCAN_CLEAR (6 * 8 + 6)

int main(void) {
    display_init();
    display_status("Starting USB...", NULL);

    if (!link_init()) {
        display_status("USB init failed", "Unplug and replug the cable, then retry");
        do kb_Scan(); while (!kb_IsDown(kb_KeyClear));
        link_cleanup();
        display_end();
        return 1;
    }

    uint8_t prev_keys[8] = { 0 };
    bool was_open = false;
    int shown = ST_NONE;
    clock_t next_scan = 0;

    for (;;) {
        link_poll();

        bool open = link_is_open();
        if (open != was_open) {
            proto_reset();
            was_open = open;
        }
        if (open) proto_pump();
        if (proto_quit_requested()) break;

        int want = !open ? ST_NO_USB : !proto_host_active() ? ST_NO_HOST : ST_STREAMING;
        if (want != shown) {
            if (want == ST_NO_USB)
                display_status("Plug the USB cable into the laptop", "Waiting for USB...");
            else if (want == ST_NO_HOST)
                display_status("USB connected", "Start the laptop app (npm start)");
            shown = want;
        }

        clock_t now = clock();
        if (now >= next_scan) {
            next_scan = now + KEY_SCAN_INTERVAL;
            kb_Scan();
            if (kb_IsDown(kb_KeyClear)) break;
            for (uint8_t group = 1; group <= 7; group++) {
                uint8_t now = kb_Data[group];
                uint8_t pressed = now & (uint8_t)~prev_keys[group];
                prev_keys[group] = now;
                if (!pressed || !open || !proto_host_active()) continue;
                for (uint8_t bit = 0; bit < 8; bit++) {
                    uint8_t code = (uint8_t)(group * 8 + bit);
                    if ((pressed & (1 << bit)) && code != SCAN_CLEAR)
                        proto_send_key(code);
                }
            }
        }
    }

    if (link_is_open()) proto_send_bye();
    link_cleanup();
    display_end();
    return 0;
}
