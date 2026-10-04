# Spectrum shelf front covers

Spectrum uses the `Box - Front` records for the `Sinclair ZX Spectrum` platform
in the LaunchBox Games Database public metadata export:
https://gamesdb.launchbox-app.com/Metadata.zip

`frontend/public/data/spectrum-front-covers.json` contains 4,334 title/image URL
records generated from the October 4, 2026 export. Artwork remains hosted by
the provider and uses the existing on-demand server artwork cache. Image rights
remain with their respective owners; this index makes no new licence claim.
Provider attribution and the source URL are retained in the JSON.

Regenerate with:

```
python scripts/import-spectrum-front-covers.py Metadata.zip frontend/public/data/spectrum-front-covers.json
```

Do not commit the ZIP/XML export. Only front-labelled records are accepted;
back, full, 3D, flyer and screenshot records are excluded. UK/Europe images are
preferred when multiple fronts exist. Spectrum uses exact/normalised title
matching; subtitle/prefix guessing is disabled to keep `1942` distinct from
`1942 Mission`. A missing match leaves the normal placeholder, never an inlay.

The server cache namespace is `spectrum-front`, separate from legacy `spectrum`
artwork. Existing local and source libraries look up this new namespace and
ignore old inlay cache hits. After deployment refresh the library and run
Download box art for Spectrum. Existing game files and other systems are untouched.
No database migration or new runtime dependency is required.

The abandoned per-game CSS crop has been removed. The selected 1942 Mission
front was downloaded and visually checked; it contains the front panel only.
