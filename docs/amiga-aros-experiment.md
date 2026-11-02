# Experimental AROS ROM launches

The normal Amiga launch path uses the user's original Kickstart ROM and is unchanged by default.

## Enable the experiment

Set this Vite build variable and rebuild the frontend:

```text
VITE_AMIGA_AROS_ENABLED=true
```

The flag only permits testing. A normal launch still uses original Kickstart. To request PUAE's built-in AROS fallback for one launch, add this query parameter to an Amiga room URL:

```text
amigaRom=aros
```

For example, append `&amigaRom=aros` when the URL already has a query string, or `?amigaRom=aros` otherwise, then select an ADF/ADZ/DMS floppy game.

AROS selection is intentionally rejected for LHA, Slave, HDF, IPF, and expanded WHDLoad content. Those paths continue to require the existing original Kickstart setup.

## ROM files

No manually installed AROS ROM is required for this experiment. The dedicated PUAE/libretro core contains an AROS Kickstart fallback and uses it when the configured proprietary Kickstart is absent. The existing AROS main and extended images under `frontend/public/amiga/roms` belong to the separate vAmiga runtime and are not copied into PUAE.

Official standalone AROS m68k builds are published by the AROS project at <https://aros.sourceforge.io/nightly1.html>. Their Kickstart images are produced under `AROS/boot/amiga` (or `AROS/boot/amiga-classic`) in the build tree. They are not required or added by this implementation.

## Compatibility record

Record each test outside the game database until the experiment has enough evidence for a stable schema:

```json
{
  "game": "Example",
  "release": "Example.adf",
  "romSource": "aros",
  "boots": false,
  "titleScreen": false,
  "controls": false,
  "sound": false,
  "gameplay": false,
  "crashesOrFreezes": false,
  "notes": ""
}
```

Reaching a title screen alone is not a compatibility pass.

## Disable and rollback

Remove `VITE_AMIGA_AROS_ENABLED` or set it to `false`, then rebuild. With the flag disabled, `amigaRom=aros` is ignored and every launch follows the existing original-Kickstart flow.
