# The Way Things Work — web preservation port

A data-driven browser edition of Dorling Kindersley's 1994 Windows CD-ROM. This repository contains the application, reproducible importer, and rights-cleared converted web media; it does not contain the original ISO or Windows executable.

Live edition: <https://blackmad.github.io/the-way-things-work-web/>

Classic mode: <https://blackmad.github.io/the-way-things-work-web/classic/>

## Requirements

- Node.js 20 or newer
- 7-Zip (`7z`)
- ImageMagick (`magick`)
- FFmpeg (`ffmpeg`)
- Tesseract (`tesseract`, optional but recommended for topic titles)
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
- Proprietary ANI sequences are decoded into browser-playable VP9/Opus WebM when their matching base screen is available; originals are always preserved.
- Every discovered section and topic is routed and searchable.
- The fixed 540×450-era compositions scale down without cropping on small screens.
- `/classic` presents the original screens as a centered CD-ROM-style stage with in-place cards, animations, contents, and page controls. Loading `/classic/` plays the authored title sequence and lands on the Workshop home screen. Detail cards and principle panels expose their own animation when one exists.

The importer recovers authored animation, page/card, red-label, See Also, related-subject, and Inventors-book navigation rectangles from the compiled Penge database. Decoded indirect handler identities are the source of truth; OCR remains a conservative fallback for handlers that have not yet been decoded and never invents a hit area. Remaining compatibility work covers the wider long-tail of indirect concept handlers and one alternate ANI variant used by two lever-principle files. See [docs/PORTING.md](docs/PORTING.md).

## Commands

```sh
npm test
npm run build
npm run validate
npm run preview
npm run hotspots
```

`npm run hotspots` re-runs authored-hotspot extraction against the existing `public/content` manifest without reconverting media. It reads `DKCODE/TWTW.PNG` from `.cache/twtw/raw` by default; set `TWTW_PENGE=/path/to/TWTW.PNG` to point at another copy.

The converted media in this repository is published with the rights holder's authorization. The original ISO and Windows runtime are not distributed here.
