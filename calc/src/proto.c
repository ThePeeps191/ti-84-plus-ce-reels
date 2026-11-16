#include "proto.h"

#include "display.h"
#include "link.h"

#include <sys/lcd.h>
#include <string.h>

#define HDR_LEN 5

static uint8_t hdr[HDR_LEN];
static uint8_t hdr_have;
static uint8_t msg_type;
static size_t msg_len;
static size_t msg_have;
static bool msg_discard; /* payload larger than the rx buffer: read and drop */
static uint8_t drop_buf[64];

static bool host_active;
static bool quit_requested;
static uint8_t ack_seq;

void proto_reset(void) {
    hdr_have = 0;
    msg_len = msg_have = 0;
    msg_discard = false;
    host_active = false;
}

bool proto_host_active(void) { return host_active; }
bool proto_quit_requested(void) { return quit_requested; }

static void send_msg(uint8_t type, const void *payload, size_t len, unsigned timeout_ms) {
    uint8_t h[HDR_LEN] = { PROTO_MAGIC, type, (uint8_t)len, (uint8_t)(len >> 8), (uint8_t)(len >> 16) };
    if (link_write_all(h, HDR_LEN, timeout_ms) && len)
        link_write_all(payload, len, timeout_ms);
}

void proto_send_key(uint8_t key) { send_msg(MSG_KEY, &key, 1, 100); }
void proto_send_bye(void) { send_msg(MSG_BYE, NULL, 0, 100); }

static void send_dump(void) {
    uint8_t bpp = display_bpp();
    size_t vram = display_vram_bytes();
    size_t len = 1 + 512 + vram;
    uint8_t h[HDR_LEN] = { PROTO_MAGIC, MSG_C_DUMP, (uint8_t)len, (uint8_t)(len >> 8), (uint8_t)(len >> 16) };
    if (!link_write_all(h, HDR_LEN, 2000)) return;
    if (!link_write_all(&bpp, 1, 2000)) return;
    if (!link_write_all((const void *)lcd_Palette, 512, 2000)) return;
    link_write_all(display_vram(), vram, 5000);
}

static void handle_message(const uint8_t *p, size_t len) {
    switch (msg_type) {
    case MSG_HELLO: {
        uint8_t reply[2] = { PROTO_VERSION, display_bpp() };
        host_active = true;
        send_msg(MSG_C_HELLO, reply, sizeof reply, 500);
        break;
    }
    case MSG_MODE:
        if (len >= 1) display_set_bpp(p[0]);
        host_active = true;
        break;
    case MSG_BLIT: {
        if (len < 8) break;
        uint16_t x = (uint16_t)(p[0] | (p[1] << 8));
        uint8_t y = p[2];
        uint16_t w = (uint16_t)(p[3] | (p[4] << 8));
        uint8_t h = p[5];
        uint8_t pal_start = p[6], pal_count = p[7];
        size_t pal_bytes = 2u * pal_count;
        size_t px_bytes = display_bpp() == 4 ? (size_t)w * h / 2 : (size_t)w * h;
        if (len >= 8 + pal_bytes + px_bytes) {
            display_set_palette(pal_start, pal_count, p + 8);
            display_blit(x, y, w, h, p + 8 + pal_bytes);
        }
        uint8_t seq = ack_seq++;
        send_msg(MSG_ACK, &seq, 1, 500);
        break;
    }
    case MSG_DUMP:
        send_dump();
        break;
    case MSG_QUIT:
        quit_requested = true;
        break;
    default:
        break;
    }
}

void proto_pump(void) {
    uint8_t *rx = display_rx_buffer();
    for (int guard = 0; guard < 64; guard++) {
        if (hdr_have < HDR_LEN) {
            int n = link_read(hdr + hdr_have, HDR_LEN - hdr_have);
            if (n <= 0) return;
            hdr_have += (uint8_t)n;
            /* resync: drop bytes until the magic leads */
            while (hdr_have > 0 && hdr[0] != PROTO_MAGIC) {
                memmove(hdr, hdr + 1, --hdr_have);
            }
            if (hdr_have < HDR_LEN) continue;
            msg_type = hdr[1];
            msg_len = (size_t)hdr[2] | ((size_t)hdr[3] << 8) | ((size_t)hdr[4] << 16);
            msg_have = 0;
            msg_discard = msg_len > display_rx_capacity();
        }
        if (msg_have < msg_len) {
            size_t want = msg_len - msg_have;
            int n;
            if (msg_discard)
                n = link_read(drop_buf, want < sizeof drop_buf ? want : sizeof drop_buf);
            else
                n = link_read(rx + msg_have, want);
            if (n <= 0) return;
            msg_have += (size_t)n;
            if (msg_have < msg_len) continue;
        }
        if (!msg_discard) handle_message(rx, msg_len);
        hdr_have = 0;
        msg_len = msg_have = 0;
        msg_discard = false;
    }
}
