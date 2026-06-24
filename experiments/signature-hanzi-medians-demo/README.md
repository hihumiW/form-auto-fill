# Hanzi Medians Signature Demo

This PoC renders a Chinese name from Hanzi Writer / Make Me a Hanzi `medians`.

It intentionally does not use uploaded fonts, outline skeletonization, LLM repair, or heavy signature-style deformation. The goal is to verify a Hanzi medians baseline plus small humanized playback factors:

1. Fetch each Chinese character's data from `hanzi-writer-data`.
2. Read each stroke's `medians` centerline points.
3. Scale those points into the signature canvas area.
4. Dynamically resample strokes by length and curvature.
5. Add slight direction-aware coordinate jitter.
6. Animate with slow starts, faster middles, slow finishes, and per-stroke pauses.
7. Export a browser snippet that replays the generated pointer events on a target canvas.

## Run

Open `index.html` in a browser, or serve this folder with a static server.

The page fetches character data from:

```text
https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/{character}.json
```

## Notes

- Only characters present in `hanzi-writer-data` can be rendered.
- Coordinates are mapped from the Hanzi data's 1024-style character space into the canvas.
- The current humanization is deliberately mild: minor size, spacing, baseline, jitter, and timing variation only.
- This demo aims to look like hand-driven stroke-order writing, not an artistic signature.
