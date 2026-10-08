"""Create small detail-panel images from the archival equipment photographs."""
from pathlib import Path
from PIL import Image, ImageOps


source = Path(__file__).resolve().parents[1] / "src/assets/tool_images"
destination = source.parent / "tool_thumbnails"
destination.mkdir(exist_ok=True)

for original in sorted(source.glob("*.jpg")):
    with Image.open(original) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        for width, height in ((256, 192), (512, 384)):
            thumbnail = ImageOps.fit(image, (width, height), method=Image.Resampling.LANCZOS)
            stem = destination / f"{original.stem}-{width}"
            thumbnail.save(stem.with_suffix(".jpg"), quality=82, optimize=True)
            thumbnail.save(stem.with_suffix(".webp"), quality=77, method=6)
            thumbnail.save(stem.with_suffix(".avif"), quality=52)
