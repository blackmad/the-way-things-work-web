# Porting notes

## Source architecture

The inspected disc is ISO 9660 volume `DKMMTWTW`, created on 1994-08-09. `DKCODE/TWTW.EXE` is a 16-bit New Executable for Windows 3.x rather than a Director or Shockwave projector. Its strings reference a custom `AnimationControl` and explicit DIB, WAV, and ANI handling.

Source inventory:

| Kind | Files | Source bytes | Web treatment |
| --- | ---: | ---: | --- |
| DIB/bitmap | 1,698 | 94,493,708 | Lossless WebP |
| ANI | 497 | 181,704,442 | VP9/Opus WebM plus preserved source |
| WAV | 100 | 4,851,122 | MP3 |

The disc contains 149 machine topic directories, 47 principle directories, and 20 inventor groups. Most main article screens are 540×450 indexed-color bitmaps. Their prose and labels are pixels, not structured text.

## Implemented vertical slice

The importer discovers content from file signatures instead of trusting extensions because several top-level bitmaps have no suffix. It groups media into stable topic IDs based on the disc layout and optionally uses OCR only to derive display titles. Original paths remain in the manifest for later behavioral mapping.

The browser application provides:

- section and subject navigation;
- subject search;
- complete screen filmstrips;
- responsive, uncropped original artwork;
- browser-native playback of converted sounds;
- deep links to topics and individual screens;
- browser playback of decoded animation sequences with embedded audio;
- keyboard-visible focus and reduced-motion support.

## Animation research

ANI is not the Windows animated-cursor RIFF format. It has a 30-byte header followed by timed records. Each record contains mono 8-bit PCM audio, an optional image rectangle, and palette indices compressed with a small RLE codec. The ASCII marker `funky!` separates each 22-byte record header from its payload. Image rows are padded to an even byte boundary, and palette index zero means “leave the base pixel unchanged.” Some patches use the original 640×480 window coordinate space, so the converter expands the video canvas when it extends beyond the page bitmap.

The decoder validates 495 of the 497 files. Across those files it parses 21,143 timed records, 13,451 image patches, and 213,758,810 decoded patch pixels without length mismatches. The two `PRINCIPL/QLVR` files omit the `funky!` record structure and are retained as an unsupported alternate variant.

Remaining decoder work:

1. Capture representative sequences in the original Windows application for timing comparison.
2. Confirm the meaning of the remaining global-header fields in a 16-bit-aware disassembler.
3. Reverse-engineer the markerless lever variant.
4. Add golden-frame fixtures that can be legally stored or generated without copying original artwork.

## Behavioral recovery

`DKCODE/TWTW.PNG` is not a bitmap. It is the compiled Penge content database: a big-endian, length-prefixed string table followed by serialized page, panel, display-object, hotspot, and action records. Direct animation and page/card hotspot records contain their original four-word rectangle and a string-table reference to the target. The importer preserves the active source-screen context and extracts both kinds into the manifest:

```json
{
  "screen": "AIRP0M",
  "hotspots": [
    { "rect": [45, 293, 74, 315], "action": "play", "target": "AIRP0M2A" },
    { "rect": [408, 42, 461, 91], "action": "open", "target": "AIRP0N" }
  ]
}
```

These are authored source coordinates, not OCR or image-analysis estimates. The web viewer scales them with the source bitmap, then plays an animation or opens the original card artwork.

Indirect product handlers do not contain a neighboring filename; they contain a compiled handler identity. Decoded identities map authored rectangles directly to their cards, detail pages, See Also panels, or principles. Thermometer is fully decoded this way, including its icon-only controls and the shared `temperature` handler. OCR remains a conservative fallback for handler identities not yet decoded: it reads only the authored rectangle and accepts a destination only when it uniquely matches an original card, panel, or known principle. Wide principle panels such as `VACF1Z` are titled from their upper band, which recovers callouts like “silvered glass walls” that small-card title OCR cannot see. When a page inherits a card's record group but carries coordinates from a different composition, the rectangle is matched against every image in the topic and accepted only where the original red ink is present; this recovers links inside panels such as the red “heat” on `VACF1Z`. Small film icons that share a compiled handler with a neighboring card label reuse that destination, and a page-level animation is preferred when the icon has one. The Inventors book likewise maps shared handler identities directly to the exact A–Z/MISC rectangles. Controls that intentionally overhang the 544×432 stage are clipped at render time instead of being discarded.

The manifest distinguishes `play`, `open`, and `navigate` actions. Both the archive viewer and `/classic` render these over the source artwork with a pointer cursor. Card overlays can themselves contain hotspots, which is required for the original See Also flow.

`/classic/` uses the two authored `TITLE` animations as the opening sequence: `TITL0M0A` builds the title artwork and `TITL2M0A` transitions it into the Workshop. The sequence ends on `WORKSHOP`, which the original animation establishes as the home screen. Direct visits to `/classic/#/topic/TITLE` replay the same sequence, and a skip control jumps straight to the Workshop. Detail cards whose artwork has a matching `<card-id>0A` animation expose a play control in the overlay, so authored sequences such as the disk-brake animation remain reachable after opening a card.

## Accessibility track

OCR output should never silently replace the original text. A later content pass should preserve a transcription next to each screen, proofread it, associate text with diagram regions, label hotspots, and transcribe sound. This enables semantic search and screen-reader access without visually rebuilding David Macaulay's layouts.
