#include "display.h"

#include <graphx.h>
#include <sys/lcd.h>
#include <string.h>

/* lcd_Control bits 1-3 select the depth: 2 = 4bpp, 3 = 8bpp. */
#define LCD_BPP_MASK 0x0E
#define LCD_BPP4 (2 << 1)
#define LCD_BPP8 (3 << 1)

#define VRAM ((uint8_t *)lcd_Ram)
#define VRAM_TOTAL (SCREEN_W * SCREEN_H * 2) /* 153600 bytes */
#define FRAME8 (SCREEN_W * SCREEN_H)         /* 76800 bytes */

static uint8_t cur_bpp = 8;

void display_init(void) {
    gfx_Begin(); /* 8bpp, palette mode, draws to lcd_Ram */
    gfx_SetDrawScreen();
    cur_bpp = 8;
}

void display_end(void) {
    gfx_End();
}

void display_set_bpp(uint8_t bpp) {
    if (bpp != 4 && bpp != 8) return;
    cur_bpp = bpp;
    lcd_Control = (lcd_Control & ~LCD_BPP_MASK) | (bpp == 4 ? LCD_BPP4 : LCD_BPP8);
    memset(VRAM, 0, display_vram_bytes());
}

uint8_t display_bpp(void) {
    return cur_bpp;
}

size_t display_vram_bytes(void) {
    return cur_bpp == 4 ? FRAME8 / 2 : FRAME8;
}

uint8_t *display_vram(void) {
    return VRAM;
}

void display_set_palette(uint8_t start, uint8_t count, const uint8_t *pal_le) {
    for (unsigned i = 0; i < count && start + i < 256; i++)
        lcd_Palette[start + i] = (uint16_t)(pal_le[2 * i] | (pal_le[2 * i + 1] << 8));
}

void display_blit(uint16_t x, uint8_t y, uint16_t w, uint8_t h, const uint8_t *src) {
    if (w == 0 || h == 0 || x + w > SCREEN_W || y + h > SCREEN_H) return;
    if (cur_bpp == 4) {
        if ((x | w) & 1) return;
        const size_t stride = SCREEN_W / 2, row = w / 2;
        uint8_t *dst = VRAM + y * stride + x / 2;
        for (uint8_t r = 0; r < h; r++, dst += stride, src += row)
            memcpy(dst, src, row);
    } else {
        uint8_t *dst = VRAM + y * SCREEN_W + x;
        for (uint8_t r = 0; r < h; r++, dst += SCREEN_W, src += w)
            memcpy(dst, src, w);
    }
}

void display_status(const char *line1, const char *line2) {
    if (cur_bpp != 8) display_set_bpp(8);
    lcd_Palette[0] = gfx_RGBTo1555(0, 0, 0);
    lcd_Palette[1] = gfx_RGBTo1555(255, 255, 255);
    lcd_Palette[2] = gfx_RGBTo1555(150, 150, 150);
    lcd_Palette[3] = gfx_RGBTo1555(230, 40, 60);
    gfx_SetDrawScreen();
    gfx_FillScreen(0);
    gfx_SetTextBGColor(0);
    gfx_SetTextTransparentColor(254);

    gfx_SetTextScale(2, 2);
    gfx_SetTextFGColor(3);
    gfx_PrintStringXY("TI-84 REELS", (SCREEN_W - gfx_GetStringWidth("TI-84 REELS")) / 2, 70);
    gfx_SetTextScale(1, 1);
    gfx_SetTextFGColor(1);
    if (line1) gfx_PrintStringXY(line1, (SCREEN_W - gfx_GetStringWidth(line1)) / 2, 120);
    gfx_SetTextFGColor(2);
    if (line2) gfx_PrintStringXY(line2, (SCREEN_W - gfx_GetStringWidth(line2)) / 2, 140);
    gfx_PrintStringXY("[clear] quit", (SCREEN_W - gfx_GetStringWidth("[clear] quit")) / 2, 210);
}

uint8_t *display_rx_buffer(void) {
    return VRAM + FRAME8;
}

size_t display_rx_capacity(void) {
    return VRAM_TOTAL - FRAME8;
}
