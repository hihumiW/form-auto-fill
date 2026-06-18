# Font Signature Path Demo

This MVP tests a deterministic alternative to LLM-generated signature coordinates:

1. Upload a Chinese `.ttf` or `.otf` font.
2. Convert the input name to an OpenType path with `opentype.js`.
3. Sample the path into normalized `strokes`.
4. Preview the outline, outline-sampled strokes, skeleton strokes, or fill-style strokes on canvas.
5. Preview a solid path mode for testing direct canvas drawing instead of touch-event stroke playback.

## Run

Open `index.html` in a browser.

The page loads `opentype.js` from CDN:

```text
https://cdn.jsdelivr.net/npm/opentype.js@1.3.3/dist/opentype.min.js
```

## Notes

- No font file is bundled to avoid font licensing issues.
- The `实心 path` mode does not export touch strokes. It previews the more practical fallback of drawing the filled font path directly onto a signature canvas, if the target signing page allows canvas manipulation.
- Use `导出实心 PNG` to get a transparent PNG dataURL. Use `复制注入脚本` to copy a quick DevTools snippet that draws the PNG into the first detected signature canvas and dispatches basic input/change/pointerup events.
- This MVP samples font outlines, so the output is closer to outlined text than true handwriting.
- The `骨架 strokes` mode rasterizes the filled font outline, thins it with Zhang-Suen skeletonization, and traces the resulting centerline pixels into strokes.
- The `填充 strokes` mode scans inside the font outline with slanted brush-like strokes. It avoids the earlier horizontal back-and-forth hatch pattern, but it is still a fill simulation rather than true handwriting.
- Skeleton tracing is still an MVP: branch ordering and stroke connection may need tuning before using it in the real signing workflow.
- `LLM 优化当前 strokes` sends the current strokes to the local proxy from `../signature-llm-demo/server.mjs`. It supports `稳健修正` and `大胆重构`; both modes now include hard constraints and client-side quality checks so abstract waves or oversized doodles are rejected instead of replacing the current result.
