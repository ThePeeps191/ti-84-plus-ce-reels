#ifndef LINK_H
#define LINK_H

#include <stdbool.h>
#include <stddef.h>

/* USB CDC serial link to the laptop (srldrvce in device mode). */

/* Initialize USB as a CDC serial device. Returns false on failure. */
bool link_init(void);
/* Pump USB events. Call often. */
void link_poll(void);
/* True while the serial device is open (the laptop has configured us). */
bool link_is_open(void);
/* Non-blocking read; returns bytes read (0 if none), or -1 on error. */
int link_read(void *buf, size_t len);
/* Write all bytes, pumping USB while waiting; gives up after timeout_ms. */
bool link_write_all(const void *buf, size_t len, unsigned timeout_ms);
/* Shut USB down (restores the OS link). */
void link_cleanup(void);

#endif
