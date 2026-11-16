/*
 * REELS - shows Instagram Reels streamed from the laptop host app over USB.
 * The calculator is a dumb framebuffer + keypad; see docs/superpowers/specs.
 */
#include "display.h"
#include "link.h"
#include "proto.h"

#include <keypadc.h>
#include <stdbool.h>
#include <time.h>

#define KEY_SCAN_INTERVAL (CLOCKS_PER_SEC / 50) /* 20 ms */

enum { ST_NONE, ST_NO_USB, ST_NO_HOST, ST_STREAMING };

static const struct { kb_lkey_t lkey; uint8_t code; } key_map[] = {
    { kb_KeyUp, KEY_UP },
    { kb_KeyDown, KEY_DOWN },
    { kb_KeyEnter, KEY_ENTER },
    { kb_Key2nd, KEY_SECOND },
    { kb_KeyAlpha, KEY_ALPHA },
};
#define NUM_KEYS (sizeof key_map / sizeof key_map[0])

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

    bool was_down[NUM_KEYS] = { false };
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
            for (unsigned i = 0; i < NUM_KEYS; i++) {
                bool down = kb_IsDown(key_map[i].lkey);
                if (down && !was_down[i] && open && proto_host_active())
                    proto_send_key(key_map[i].code);
                was_down[i] = down;
            }
        }
    }

    if (link_is_open()) proto_send_bye();
    link_cleanup();
    display_end();
    return 0;
}
