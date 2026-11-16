# ----------------------------
# REELS - Instagram Reels viewer (USB-tethered to the laptop host app)
# Build: put $CEDEV/bin on PATH and run `make`
# ----------------------------

NAME = REELS
ICON = icon.png
DESCRIPTION = "Instagram Reels over USB"
COMPRESSED = NO
ARCHIVED = YES

# SRL_BUF_SIZE: USB serial ring buffer; bigger buffers mean bigger bulk transfers and higher throughput.
CFLAGS = -Wall -Wextra -O3 -DSRL_BUF_SIZE=16384
CXXFLAGS = -Wall -Wextra -O3

# ----------------------------

include $(shell cedev-config --makefile)
