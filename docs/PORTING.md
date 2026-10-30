# Porting notes

## Source architecture

The inspected disc is ISO 9660 volume `DKMMTWTW`, created on 1994-08-09. `DKCODE/TWTW.EXE` is a 16-bit New Executable for Windows 3.x rather than a Director or Shockwave projector. Its strings reference a custom `AnimationControl`, a `DKPenge` runtime, and explicit DIB, WAV, and ANI handling.

Source inventory:

| Kind | Files | Source bytes | Web treatment |
| --- | ---: | ---: | --- |
| DIB/bitmap | 1,698 | 94,493,708 | Lossless WebP |
| ANI | 497 | 181,704,442 | VP9/Opus WebM plus preserved source |
| WAV | 100 | 4,851,122 | MP3 |

The disc contains 149 machine topic directories, 47 principle directories, and 20 inventor groups. Most main article screens are 540×450 indexed-color bitmaps sharing one global palette. Their prose and labels are pixels, not structured text.

The original window is 640×480: a 94×460 navigation panel (`NAV/NAV.DIB`) on the left, and the page at (94, 4) inside a thin frame (`FRAMETOP`, `FRAMESID`, `FRAMEBOT`). The panel's nine buttons are hard-wired in the executable.

## Animation format

ANI is not the Windows animated-cursor RIFF format. It has a 30-byte header followed by timed records. Each record contains mono 8-bit PCM audio, an optional image rectangle, and palette indices compressed with a small RLE codec. The ASCII marker `funky!` separates each 22-byte record header from its payload. Image rows are padded to an even byte boundary. Patches are opaque: every index, including palette entry zero (black), replaces the pixel beneath it. An earlier assumption that zero was transparent dropped all black outlines and washed every animation out; the title build-up now ends pixel-identical to the finished title bitmap. Some patches use the original 640×480 window coordinate space, so the converter expands the video canvas when it extends beyond the page bitmap.

The decoder validates 495 of the 497 files. The two `PRINCIPL/QLVR` files omit the `funky!` record structure and are retained as an unsupported alternate variant.

## The Penge content database

`DKCODE/TWTW.PNG` is not a bitmap. It is the compiled Penge content database, decoded by `scripts/penge.mjs`. All integers are big-endian.

1. A 10-byte header: version, string-table byte length (u32 at 4), and string count (u16 at 8).
2. A string table of length-prefixed Latin-1 strings, sorted alphabetically. It holds every index heading, directory path, and media name.
3. The Index table (see below).
4. Display-object records, each followed by its hotspots.

### Display-object records

A 38-byte header:

| Offset | Field |
| ---: | --- |
| 0 | type: `0x65` popup (card, panel, glossary entry), `0x66` base page, `0x67` scrolling index panel |
| 2 | flags |
| 4, 6 | x, y where a popup is placed over the 540×450 page |
| 8 | 1-based string reference to the topic directory, for example `\ARTICLE3\THER\` |
| 10 | `1, 0xc9, 1` |
| 16 | ordinal within the topic |
| 18 | `0x259, 2, 0, 0, 0` |
| 28, 30 | width, height |
| 32 | `3`, then a 1-based u32 string reference to the bitmap name, for example `THER0m` |

### Hotspots

Each hotspot (class `0x25b`) has a 22-byte header, one or more actions, and a two-byte trailer:

| Offset | Field |
| ---: | --- |
| 0 | `0x25b` |
| 2 | cursor name (0-based string reference, usually `Arrow`) |
| 4 | `4`, then left, top, right, bottom |
| 14 | `0x748, 1, 4` |
| 20 | action count |

Actions:

| Code | Meaning | Parameters |
| ---: | --- | --- |
| 1 | open popup | u32 record reference, u16 flag |
| 2 | built-in print/zoom control | u16, u16 |
| 3 | change page (or swap the open popup) | u32 record reference, u16 flag |
| 4 | play sound | 1-based u16 name, `0xffffffff`, `1`, `1`, `0` |
| 7 | play animation | 1-based u16 name, `0xffffffff`, `1`, `1`, `0` |
| 11 | Options dialog control | u16 |

A record reference is the file offset of the target record minus `0x1515b`. Every one of the 10,210 hotspots in the shipped database resolves to a popup or page record, which is how all links were recovered without reading pixels. A control that plays a sound and changes page carries both.

### The Index

Between the string table and the first page record is the Index: rows of `u16 heading, u16 flags, u16 0, u32 page, u16 count, u32 × count popups`, in alphabetical order. The page block in each row belongs to the heading in the row before it, and a heading repeats when it has several destinations. The web edition shows the heading's page and then opens the first popup, which is what the original list box did.

### What the database does not contain

The History of Machines era dial, the A–Z dial, the Principles of Science map, the navigation panel, and the text field of the Index are implemented in the executable. Their controls are authored by hand in `scripts/builtin-hotspots.mjs` and `src/main.tsx` against the converted screens.

Pages such as the Principles "Mammoth Movies" projector have no hotspots at all: the executable plays the page's title card and film on arrival, and the web viewers do the same.

## Manifest

The importer writes `public/content/manifest.json`. Each image carries its hotspots:

```json
{ "rect": [473, 395, 537, 446], "action": "open", "target": "THER0J", "url": "/content/images/ARTICLE3/THER/THER0J.webp", "at": [151, 123] }
{ "rect": [63, 66, 130, 81], "action": "navigate", "target": "Bourdon Gauge", "topicId": "ARTICLE2/PRES", "screen": 0, "url": "#/topic/ARTICLE2%2FPRES" }
{ "rect": [10, 8, 129, 83], "action": "play", "target": "THER0M0A", "url": "/content/animations/ARTICLE3/THER/THER0M0A.webm" }
{ "rect": [410, 348, 440, 383], "action": "sound", "target": "WWWW0M3S", "url": "/content/audio/WORKSHOP/WWWW0M3S.mp3" }
```

`manifest.index` lists the decoded headings with their page, screen, and card. `npm run validate` checks every reference against the converted media.

## Accessibility track

OCR output should never silently replace the original text. A later content pass should preserve a transcription next to each screen, proofread it, associate text with diagram regions, label hotspots, and transcribe sound. This enables semantic search and screen-reader access without visually rebuilding David Macaulay's layouts.
