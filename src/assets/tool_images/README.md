# Tool Images

Place original tool photos here as `[tool_id].jpg`.

For example, if a tool has ID `1`, the image should be `1.jpg`.

The application displays generated thumbnails from `../tool_thumbnails/` and falls back to a placeholder if none exists. After adding or changing a photo, install Python Pillow and run `python scripts/optimize-tool-images.py` from the repository root. The script creates 256 px and 512 px JPEG, WebP, and AVIF variants. Keep the originals here for regeneration; they are not imported into the site bundle.
