/* Included in wasm-genplus's wasm.c by build-retroachievements.ps1. */
uint8_t* EMSCRIPTEN_KEEPALIVE ra_get_work_ram(void) { return work_ram; }
uint8_t* EMSCRIPTEN_KEEPALIVE ra_get_save_ram(void) { return sram.detected ? sram.sram : 0; }
