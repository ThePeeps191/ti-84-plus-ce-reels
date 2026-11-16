#ifndef PROTO_H
#define PROTO_H

#include <stdbool.h>
#include <stdint.h>

/* Wire protocol shared with host/src/protocol.js.
 * Frame: 0xA5, type u8, len u24 LE, payload[len]. */

#define PROTO_MAGIC   0xA5
#define PROTO_VERSION 1

/* host -> calc */
#define MSG_HELLO 0x01
#define MSG_MODE  0x10
#define MSG_BLIT  0x12
#define MSG_DUMP  0x20
#define MSG_QUIT  0x30
/* calc -> host */
#define MSG_C_HELLO 0x81
#define MSG_ACK     0x82
#define MSG_KEY     0x83
#define MSG_BYE     0x84
#define MSG_C_DUMP  0x85

#define KEY_UP     1
#define KEY_DOWN   2
#define KEY_ENTER  3
#define KEY_SECOND 4
#define KEY_ALPHA  5

/* Forget any partial message (call when the link (re)opens). */
void proto_reset(void);
/* Read whatever bytes are available and act on complete messages. */
void proto_pump(void);
/* The host has said HELLO since the link opened. */
bool proto_host_active(void);
/* The host asked us to quit. */
bool proto_quit_requested(void);

void proto_send_key(uint8_t key);
void proto_send_bye(void);

#endif
