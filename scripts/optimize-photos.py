#!/usr/bin/env python3
"""
Downsizes content/photos/** for the web: caps the long edge, re-encodes as
JPEG, and drops every scrap of metadata except when the photo was taken.

Photos are served straight out of public/ (copy-assets.mjs mirrors them there),
and public/ is the one directory Astro copies byte-for-byte — so the image
pipeline never sees these files. This script is the only thing standing between
a 10 MB camera original and the 200px gallery tile it gets displayed in.

Three things happen to every image:

  * EXIF orientation is baked into the pixels before the resize, so the two
    sideways-on-disk phone photos stay the right way up once the tag is gone.
  * Metadata is rebuilt from scratch keeping only the capture date (DateTime,
    DateTimeOriginal, DateTimeDigitized). GPS coordinates of the courts, camera
    make and model and the rest are dropped — these files are publicly
    downloadable, and several carried a location fix.
  * PNGs become JPEGs. Every PNG in the repo is fully opaque, and re-encoding a
    photographic PNG at this size lands several times larger than the JPEG.
    The rename is mirrored into photos.yaml by exact string replacement, so the
    manifest keeps its comments and its order (order is gallery order).

Re-encoding always wins over keeping the original, even on the handful of files
that are already small — that is the only way the metadata actually goes away.
Files already down to a date-only EXIF are skipped, so this is safe to re-run.

Usage:
    npm run optimize-photos               # do it
    npm run optimize-photos -- --dry-run  # just say what would happen

Requires Pillow:  python3 -m pip install Pillow
"""

import argparse
import os
import re
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is not installed. Run: python3 -m pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTOS = os.path.join(ROOT, "content", "photos")
MANIFEST = os.path.join(PHOTOS, "photos.yaml")
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}

# The only metadata that survives. 306 is IFD0 DateTime; 36867/36868 are
# DateTimeOriginal/Digitized in the Exif sub-IFD. 34665 is the pointer to that
# sub-IFD — structural, written by the encoder, not something we choose to keep.
DATE_IFD0, DATE_SUB, EXIF_PTR = 306, (36867, 36868), 34665
EXIF_IFD, GPS_IFD = 0x8769, 0x8825


def rel(path):
    """Manifest-style path: relative to content/photos, forward slashes."""
    return os.path.relpath(path, PHOTOS).replace(os.sep, "/")


def find_images():
    out = []
    for dirpath, _, names in os.walk(PHOTOS):
        for n in sorted(names):
            if os.path.splitext(n)[1].lower() in EXTS:
                out.append(os.path.join(dirpath, n))
    return sorted(out)


def date_only_exif(src):
    """A fresh EXIF block carrying the capture date and nothing else."""
    out = Image.Exif()
    if src.get(DATE_IFD0):
        out[DATE_IFD0] = src.get(DATE_IFD0)
    sub_in = src.get_ifd(EXIF_IFD)
    sub_out = out.get_ifd(EXIF_IFD)
    for tag in DATE_SUB:
        if sub_in.get(tag):
            sub_out[tag] = sub_in.get(tag)
    return out


def is_clean(im):
    """True once metadata is down to the date tags — nothing left to strip."""
    ex = im.getexif()
    if any(tag not in (DATE_IFD0, EXIF_PTR) for tag in ex):
        return False
    if ex.get_ifd(GPS_IFD):
        return False
    return all(tag in DATE_SUB for tag in ex.get_ifd(EXIF_IFD))


def needs_work(path, max_dim):
    """Already small, already JPEG, already stripped — nothing left to gain."""
    if os.path.splitext(path)[1].lower() not in (".jpg", ".jpeg"):
        return True
    with Image.open(path) as im:
        return max(im.size) > max_dim or not is_clean(im)


def optimize(path, max_dim, quality, dry_run):
    """Returns (new_path, old_bytes, new_bytes). new_path differs only for PNGs."""
    old_bytes = os.path.getsize(path)
    stem, ext = os.path.splitext(path)
    new_path = path if ext.lower() in (".jpg", ".jpeg") else stem + ".jpg"

    if new_path != path and os.path.exists(new_path):
        sys.exit(f"refusing to overwrite an existing file: {rel(new_path)}")

    with Image.open(path) as src:
        exif = date_only_exif(src.getexif())
        im = ImageOps.exif_transpose(src).convert("RGB")
        im.thumbnail((max_dim, max_dim), Image.LANCZOS)
        save = dict(
            quality=quality, optimize=True, progressive=True, exif=exif
        )
        if dry_run:
            tmp = os.path.join(
                os.environ.get("TMPDIR", "/tmp"), "tnt-optimize-probe.jpg"
            )
            im.save(tmp, "JPEG", **save)
            new_bytes = os.path.getsize(tmp)
            os.remove(tmp)
            return new_path, old_bytes, new_bytes

        # Write beside the target, then swap, so a crash can't leave a half file.
        tmp = new_path + ".tmp"
        im.save(tmp, "JPEG", **save)

    os.replace(tmp, new_path)
    if new_path != path:
        os.remove(path)
    return new_path, old_bytes, os.path.getsize(new_path)


def update_manifest(renames, dry_run):
    """Rewrite only the `file:` values that changed, leaving the rest untouched."""
    if not renames:
        return
    text = open(MANIFEST, encoding="utf-8").read()
    for old, new in renames.items():
        pattern = re.compile(r"(^\s*-?\s*file:\s*)" + re.escape(old) + r"(\s*$)", re.M)
        text, n = pattern.subn(lambda m: m.group(1) + new + m.group(2), text)
        if n != 1:
            sys.exit(f"expected exactly 1 manifest entry for {old}, found {n}")
    if not dry_run:
        open(MANIFEST, "w", encoding="utf-8").write(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-dim", type=int, default=2000, help="cap on the long edge")
    ap.add_argument("--quality", type=int, default=82, help="JPEG quality")
    ap.add_argument("--dry-run", action="store_true", help="report, change nothing")
    args = ap.parse_args()

    images = find_images()
    if not images:
        sys.exit(f"no images under {rel(PHOTOS)}")

    renames, total_old, total_new, skipped = {}, 0, 0, 0
    for path in images:
        before = rel(path)
        if not needs_work(path, args.max_dim):
            skipped += 1
            total_old += os.path.getsize(path)
            total_new += os.path.getsize(path)
            continue
        new_path, old_b, new_b = optimize(path, args.max_dim, args.quality, args.dry_run)
        after = rel(new_path)
        if after != before:
            renames[before] = after
        total_old += old_b
        total_new += new_b
        note = f" -> {os.path.basename(after)}" if after != before else ""
        print(f"  {before:<40} {old_b/1048576:6.1f}MB -> {new_b/1024:6.0f}KB{note}")

    update_manifest(renames, args.dry_run)

    mb = 1048576
    print(f"\n{len(images) - skipped} optimised, {skipped} already fine")
    if renames:
        print(f"{len(renames)} renamed PNG->JPEG, photos.yaml updated to match")
    print(
        f"total: {total_old/mb:.1f}MB -> {total_new/mb:.1f}MB "
        f"({100 - 100*total_new/total_old:.0f}% smaller)"
    )
    if args.dry_run:
        print("\n(dry run — nothing was written)")


if __name__ == "__main__":
    main()
