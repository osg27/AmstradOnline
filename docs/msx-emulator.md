# MSX emulator preview

OldStyleGaming runs MSX games through the blueMSX libretro core inside the existing self-hosted EmulatorJS runtime. The integration is an admin-only preview: the frontend only lists it for admin accounts, and the FastAPI room and WebSocket access checks reject non-admin users even if they craft a request or alter browser storage.

The `msx` room system supports solo and two-player hosted rooms. It uses the normal OldStyleGaming host-stream model, controller profiles, keyboard forwarding, room audio/video capture, and Supporter recording controls. Supported media extensions are `.rom`, `.mx1`, `.mx2`, `.dsk`, `.cas`, `.m3u`, and `.zip`. The core uses its software database and file extension to select MSX, MSX2, or MSX2+ where possible.

Only the freely redistributable C-BIOS machine ROMs are included. Cartridge software works without proprietary firmware. C-BIOS does not include a disk ROM, so disk-image compatibility is limited during this preview; do not add manufacturer BIOS ROMs to the repository without confirming redistribution rights. The core and bundled machine files retain their upstream notices in `frontend/public/msx/blueMSX-license.txt` and inside the C-BIOS machine directories in `frontend/public/msx/bluemsx-system.zip`.

No database migration is required. Rooms already store the system identifier as a string.
