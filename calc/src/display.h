#ifndef DISPLAY_H
#define DISPLAY_H

#include <stdint.h>
#include <stddef.h>

#define SCREEN_W 320
#define SCREEN_H 240

/* Start graphics (8bpp) and show nothing yet. */
void display_init(void);
/* Restore the OS screen. */
void display_end(void);

/* Switch LCD depth to 4 or 8 bpp and clear the screen to palette index 0. */
void display_set_bpp(uint8_t bpp);
uint8_t display_bpp(void);
/* Bytes of VRAM in use for the current depth. */
size_t display_vram_bytes(void);
uint8_t *display_vram(void);

/* Write `count` 1555 palette entries starting at `start`. */
void display_set_palette(uint8_t start, uint8_t count, const uint8_t *pal_le);
/* Copy packed pixels (current bpp, rows tightly packed) into a rectangle.
 * In 4bpp, x and w must be even. Out-of-bounds rectangles are clipped by rejecting them. */
void display_blit(uint16_t x, uint8_t y, uint16_t w, uint8_t h, const uint8_t *src);

/* Status screen: forces 8bpp and draws a title and two message lines. */
void display_status(const char *line1, const char *line2);

/* Scratch buffer for incoming messages: the VRAM half that is never displayed. */
uint8_t *display_rx_buffer(void);
size_t display_rx_capacity(void);

#endif
