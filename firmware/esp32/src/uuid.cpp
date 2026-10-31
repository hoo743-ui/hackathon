#include "uuid.h"

#include <esp_random.h>

namespace uuid {

void newV4(char out[STR_LEN + 1]) {
    uint8_t bytes[16];
    for (int w = 0; w < 4; ++w) {
        const uint32_t r = esp_random();
        bytes[w * 4 + 0] = static_cast<uint8_t>(r);
        bytes[w * 4 + 1] = static_cast<uint8_t>(r >> 8);
        bytes[w * 4 + 2] = static_cast<uint8_t>(r >> 16);
        bytes[w * 4 + 3] = static_cast<uint8_t>(r >> 24);
    }
    formatV4(bytes, out);
}

}  // namespace uuid
