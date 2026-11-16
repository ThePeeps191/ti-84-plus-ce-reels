#include "link.h"

#include <srldrvce.h>
#include <time.h>

#ifndef SRL_BUF_SIZE
#define SRL_BUF_SIZE 4096
#endif

static srl_device_t srl;
static bool srl_open = false;
static uint8_t srl_buf[SRL_BUF_SIZE];

static usb_error_t handle_usb_event(usb_event_t event, void *event_data, usb_callback_data_t *cb) {
    usb_error_t err;
    if ((err = srl_UsbEventCallback(event, event_data, cb)) != USB_SUCCESS)
        return err;

    /* We are the device; the laptop is the host. */
    if (event == USB_HOST_CONFIGURE_EVENT && !srl_open) {
        usb_device_t host = usb_FindDevice(NULL, NULL, USB_SKIP_HUBS);
        if (host != NULL &&
            srl_Open(&srl, host, srl_buf, sizeof srl_buf, SRL_INTERFACE_ANY, 115200) == SRL_SUCCESS)
            srl_open = true;
    }
    if (event == USB_DEVICE_DISCONNECTED_EVENT && srl_open) {
        srl_Close(&srl);
        srl_open = false;
    }
    return USB_SUCCESS;
}

bool link_init(void) {
    return usb_Init(handle_usb_event, NULL, srl_GetCDCStandardDescriptors(), USB_DEFAULT_INIT_FLAGS) == USB_SUCCESS;
}

void link_poll(void) {
    usb_HandleEvents();
}

bool link_is_open(void) {
    return srl_open;
}

int link_read(void *buf, size_t len) {
    if (!srl_open) return -1;
    int n = srl_Read(&srl, buf, len);
    if (n < 0) {
        srl_Close(&srl);
        srl_open = false;
    }
    return n;
}

bool link_write_all(const void *buf, size_t len, unsigned timeout_ms) {
    const uint8_t *p = buf;
    clock_t deadline = clock() + (clock_t)timeout_ms * CLOCKS_PER_SEC / 1000;
    while (len > 0) {
        if (!srl_open) return false;
        int n = srl_Write(&srl, p, len);
        if (n < 0) {
            srl_Close(&srl);
            srl_open = false;
            return false;
        }
        p += n;
        len -= (size_t)n;
        if (len == 0) break;
        if (clock() > deadline) return false;
        usb_HandleEvents();
    }
    return true;
}

void link_cleanup(void) {
    if (srl_open) {
        srl_Close(&srl);
        srl_open = false;
    }
    usb_Cleanup();
}
