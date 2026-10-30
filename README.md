# The Way Things Work — web preservation port

A data-driven browser edition of Dorling Kindersley's 1994 Windows CD-ROM. This repository contains the application, reproducible importer, and rights-cleared converted web media; it does not contain the original ISO or Windows executable.

Live edition: <https://blackmad.github.io/the-way-things-work-web/>

Classic mode: <https://blackmad.github.io/the-way-things-work-web/classic/>

## Requirements

- Node.js 20 or newer
- 7-Zip (`7z`)
- ImageMagick (`magick`)
- FFmpeg (`ffmpeg`)
- Tesseract (`tesseract`, optional, only used to read topic titles)
- A legally obtained copy of the original ISO

## Import and run

```sh
npm install
npm run import -- "/absolute/path/to/Way Things Work.iso"
npm run dev
```

The importer extracts temporary files into the Git-ignored `.cache/twtw`, writes web media and `manifest.json` to `public/content`, and records the ISO's SHA-256 fingerprint. The converted `public/content` edition is committed so GitHub Pages can serve it.

To regenerate with a different worker count:

```sh
TWTW_JOBS=4 npm run import -- "/absolute/path/to/Way Things Work.iso"
```

## Current fidelity

- All bitmap screens are converted losslessly to WebP.
- All Microsoft ADPCM sounds are converted to MP3.
- Proprietary ANI sequences are decoded into browser-playable VP9/Opus WebM; originals are always preserved.
- Every link, card, sound, and film control is decoded from the compiled Penge content database (`DKCODE/TWTW.PNG`), so the web edition has the same 10,000-plus interactive areas as the disc. Cards open at their authored positions, red words open their glossary entries, and See Also panels lead to the right subjects.
- The Index is decoded from the same database: 1,856 headings that show a page and open its card.
- `/classic` presents the original window: the navigation panel on the left, the page in its frame, the authored title sequence on load, and "Mammoth Movies" pages that play on arrival.
- The History of Machines era dial, the A–Z dial, and the Principles of Science map are wired in the original executable rather than the database, so their controls are authored by hand in `scripts/builtin-hotspots.mjs`.

See [docs/PORTING.md](docs/PORTING.md) for the file formats.

## Commands

```sh
npm test            # unit tests for the ANI codec and the Penge decoder
npm run build
npm run validate    # checks every manifest link against the converted media
npm run preview
npm run hotspots    # re-extract links and the index without reconverting media
npm run animations  # re-render animations without reconverting images or sounds
```

`npm run hotspots` and `npm run animations` read from `.cache/twtw/raw` by default; set `TWTW_PENGE=/path/to/TWTW.PNG` or `TWTW_CACHE=/path/to/extracted/disc` to point elsewhere.

The converted media in this repository is published with the rights holder's authorization. The original ISO and Windows runtime are not distributed here.
