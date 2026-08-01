#!/bin/bash
# Generate a complete iOS AppIcon.appiconset from web/public/icon.png (1024x1024).
# Includes all required iPhone, iPad, and App Store marketing sizes so the IPA
# ships with the finalized LifeVault shield/vault icon and no placeholder icons.
#
# Key guarantees:
#   - Every icon is a REAL opaque PNG (no symlinks, no alpha channel).
#   - The 120x120 iPhone icon (60pt@2x) is a dedicated file, not a symlink.
#   - Build-time checks verify pixel dimensions and opacity for every file.
#   - Only PNG files + Contents.json inside AppIcon.appiconset are replaced;
#     the asset catalog folder itself is preserved.
#
# Run during the Codemagic iOS build after `bunx cap sync ios`.
set -euo pipefail

SOURCE="${1:-web/public/icon.png}"
OUT_DIR="${2:-ios/App/App/Assets.xcassets/AppIcon.appiconset}"

if [ ! -f "$SOURCE" ]; then
  echo "ERROR: Source icon not found at $SOURCE"
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "ERROR: sips is not available — this script must run on macOS"
  exit 1
fi

# Resolve SOURCE to an absolute path BEFORE any cd.
# The old code passed a relative path (e.g. public/icon.png) and then did
# cd "$OUT_DIR", which made the relative path unresolvable — sips silently
# failed and zero icons were generated.
SOURCE="$(cd "$(dirname "$SOURCE")" && pwd)/$(basename "$SOURCE")"

# Create the output directory if it does not exist, then resolve to absolute.
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

echo "--- Icon generation ---"
echo "Source icon : $SOURCE"
echo "Output dir  : $OUT_DIR"
SRC_W="$(sips -g pixelWidth "$SOURCE" | awk '/pixelWidth/ {print $2}')"
SRC_H="$(sips -g pixelHeight "$SOURCE" | awk '/pixelHeight/ {print $2}')"
echo "Source size : ${SRC_W}x${SRC_H}"
if [ "$SRC_W" != "$SRC_H" ]; then
  echo "WARNING: Source icon is not square (${SRC_W}x${SRC_H}) — icons may look distorted."
fi
echo ""

cd "$OUT_DIR"

# Remove only the PNG files and Contents.json so the asset catalog folder
# itself is preserved. This prevents breaking the native asset catalog.
rm -f *.png Contents.json

# --- Step 1: Create an opaque master copy ---
# sips -s hasAlpha false is a NO-OP (hasAlpha is read-only in sips). The
# proper way to strip the alpha channel is a BMP roundtrip: BMP has no alpha
# support, so converting PNG -> BMP -> PNG guarantees a fully opaque image
# with a white background where transparency used to be.
TEMP_DIR="$(mktemp -d)"
TEMP_BMP="$TEMP_DIR/icon_opaque.bmp"
TEMP_SOURCE="$TEMP_DIR/icon_opaque.png"

# Convert source to BMP (strips alpha, flattens onto white background).
if ! sips -s format bmp "$SOURCE" --out "$TEMP_BMP" >/dev/null 2>&1; then
  echo "ERROR: Failed to create opaque BMP master from $SOURCE"
  ls -la "$TEMP_DIR" 2>/dev/null || true
  exit 1
fi
# Convert BMP back to PNG (now opaque, no alpha channel).
if ! sips -s format png "$TEMP_BMP" --out "$TEMP_SOURCE" >/dev/null 2>&1; then
  echo "ERROR: Failed to convert BMP master back to PNG"
  ls -la "$TEMP_DIR" 2>/dev/null || true
  exit 1
fi
# Verify the master copy is opaque.
MASTER_ALPHA="$(sips -g hasAlpha "$TEMP_SOURCE" 2>/dev/null | awk '/hasAlpha/ {print $2}')"
if [ "$MASTER_ALPHA" = "yes" ]; then
  echo "WARNING: Master copy still has alpha after BMP roundtrip — resized icons may retain transparency."
fi
echo "OK  : Opaque master copy created (alpha=${MASTER_ALPHA:-unknown})"

# --- Step 2: Resize into every required size ---
# Each file is a real, independent PNG — no symlinks.
# Alpha is stripped via BMP roundtrip on each resized file (belt and suspenders).
resize() {
  local size="$1"
  local name="$2"
  if ! sips -z "$size" "$size" "$TEMP_SOURCE" --out "$name" >/dev/null 2>&1; then
    echo "ERROR: Failed to resize icon to ${size}x${size} ($name)"
    exit 1
  fi
  # Strip any residual alpha via BMP roundtrip on the resized file.
  local tmp_bmp="${name%.png}.bmp"
  if sips -s format bmp "$name" --out "$tmp_bmp" >/dev/null 2>&1; then
    sips -s format png "$tmp_bmp" --out "$name" >/dev/null 2>&1 || true
    rm -f "$tmp_bmp"
  fi
}

# iPhone sizes
resize 40   AppIcon-20x20@2x.png
resize 60   AppIcon-20x20@3x.png
resize 58   AppIcon-29x29@2x.png
resize 87   AppIcon-29x29@3x.png
resize 80   AppIcon-40x40@2x.png
resize 120  AppIcon-40x40@3x.png
resize 120  AppIcon-60x60@2x.png
resize 180  AppIcon-60x60@3x.png

# iPad sizes
resize 20   AppIcon-20x20@1x~ipad.png
resize 40   AppIcon-20x20@2x~ipad.png
resize 29   AppIcon-29x29@1x~ipad.png
resize 58   AppIcon-29x29@2x~ipad.png
resize 40   AppIcon-40x40@1x~ipad.png
resize 80   AppIcon-40x40@2x~ipad.png
resize 76   AppIcon-76x76@1x~ipad.png
resize 152  AppIcon-76x76@2x~ipad.png
resize 167  AppIcon-83.5x83.5@2x~ipad.png

# App Store marketing icon (used for both iPhone and iPad listings)
resize 1024 AppIcon-1024x1024@1x.png

# --- Step 3: Write Contents.json ---
cat > Contents.json <<'JSON'
{
  "images": [
    {
      "size": "20x20",
      "idiom": "iphone",
      "filename": "AppIcon-20x20@2x.png",
      "scale": "2x"
    },
    {
      "size": "20x20",
      "idiom": "iphone",
      "filename": "AppIcon-20x20@3x.png",
      "scale": "3x"
    },
    {
      "size": "29x29",
      "idiom": "iphone",
      "filename": "AppIcon-29x29@2x.png",
      "scale": "2x"
    },
    {
      "size": "29x29",
      "idiom": "iphone",
      "filename": "AppIcon-29x29@3x.png",
      "scale": "3x"
    },
    {
      "size": "40x40",
      "idiom": "iphone",
      "filename": "AppIcon-40x40@2x.png",
      "scale": "2x"
    },
    {
      "size": "40x40",
      "idiom": "iphone",
      "filename": "AppIcon-40x40@3x.png",
      "scale": "3x"
    },
    {
      "size": "60x60",
      "idiom": "iphone",
      "filename": "AppIcon-60x60@2x.png",
      "scale": "2x"
    },
    {
      "size": "60x60",
      "idiom": "iphone",
      "filename": "AppIcon-60x60@3x.png",
      "scale": "3x"
    },
    {
      "size": "20x20",
      "idiom": "ipad",
      "filename": "AppIcon-20x20@1x~ipad.png",
      "scale": "1x"
    },
    {
      "size": "20x20",
      "idiom": "ipad",
      "filename": "AppIcon-20x20@2x~ipad.png",
      "scale": "2x"
    },
    {
      "size": "29x29",
      "idiom": "ipad",
      "filename": "AppIcon-29x29@1x~ipad.png",
      "scale": "1x"
    },
    {
      "size": "29x29",
      "idiom": "ipad",
      "filename": "AppIcon-29x29@2x~ipad.png",
      "scale": "2x"
    },
    {
      "size": "40x40",
      "idiom": "ipad",
      "filename": "AppIcon-40x40@1x~ipad.png",
      "scale": "1x"
    },
    {
      "size": "40x40",
      "idiom": "ipad",
      "filename": "AppIcon-40x40@2x~ipad.png",
      "scale": "2x"
    },
    {
      "size": "76x76",
      "idiom": "ipad",
      "filename": "AppIcon-76x76@1x~ipad.png",
      "scale": "1x"
    },
    {
      "size": "76x76",
      "idiom": "ipad",
      "filename": "AppIcon-76x76@2x~ipad.png",
      "scale": "2x"
    },
    {
      "size": "83.5x83.5",
      "idiom": "ipad",
      "filename": "AppIcon-83.5x83.5@2x~ipad.png",
      "scale": "2x"
    },
    {
      "size": "1024x1024",
      "idiom": "ios-marketing",
      "filename": "AppIcon-1024x1024@1x.png",
      "scale": "1x"
    }
  ],
  "info": {
    "version": 1,
    "author": "xcode"
  }
}
JSON

# --- Step 4: Verify every icon file ---
# Check that each file is a real file (not a symlink), has the correct pixel
# dimensions, and is opaque (no alpha channel). Fail the build if any check
# fails — this prevents another App Store rejection for missing/bad icons.
echo "--- Verifying generated icon files ---"

# Map of "filename:expected_pixel_size" for every required icon.
declare -a ICON_CHECKS=(
  "AppIcon-20x20@2x.png:40"
  "AppIcon-20x20@3x.png:60"
  "AppIcon-29x29@2x.png:58"
  "AppIcon-29x29@3x.png:87"
  "AppIcon-40x40@2x.png:80"
  "AppIcon-40x40@3x.png:120"
  "AppIcon-60x60@2x.png:120"
  "AppIcon-60x60@3x.png:180"
  "AppIcon-20x20@1x~ipad.png:20"
  "AppIcon-20x20@2x~ipad.png:40"
  "AppIcon-29x29@1x~ipad.png:29"
  "AppIcon-29x29@2x~ipad.png:58"
  "AppIcon-40x40@1x~ipad.png:40"
  "AppIcon-40x40@2x~ipad.png:80"
  "AppIcon-76x76@1x~ipad.png:76"
  "AppIcon-76x76@2x~ipad.png:152"
  "AppIcon-83.5x83.5@2x~ipad.png:167"
  "AppIcon-1024x1024@1x.png:1024"
)

ALL_OK=true
for entry in "${ICON_CHECKS[@]}"; do
  filename="${entry%%:*}"
  expected="${entry##*:}"
  if [ ! -f "$filename" ]; then
    echo "FAIL: $filename is missing"
    ALL_OK=false
    continue
  fi
  if [ -L "$filename" ]; then
    echo "FAIL: $filename is a symlink, not a real file"
    ALL_OK=false
    continue
  fi
  # Get pixel dimensions via sips.
  actual_w="$(sips -g pixelWidth "$filename" | awk '/pixelWidth/ {print $2}')"
  actual_h="$(sips -g pixelHeight "$filename" | awk '/pixelHeight/ {print $2}')"
  if [ "$actual_w" != "$expected" ] || [ "$actual_h" != "$expected" ]; then
    echo "FAIL: $filename is ${actual_w}x${actual_h}, expected ${expected}x${expected}"
    ALL_OK=false
    continue
  fi
  # Check for alpha channel.
  has_alpha="$(sips -g hasAlpha "$filename" 2>/dev/null | awk '/hasAlpha/ {print $2}')"
  if [ "$has_alpha" = "yes" ]; then
    echo "FAIL: $filename has an alpha channel (must be opaque)"
    ALL_OK=false
    continue
  fi
  echo "OK  : $filename (${actual_w}x${actual_h}, opaque)"
done

if [ "$ALL_OK" != "true" ]; then
  echo "ERROR: One or more icon files failed verification."
  exit 1
fi

# --- Step 5: Verify Contents.json references the 120x120 icon ---
if ! grep -q "AppIcon-60x60@2x.png" Contents.json; then
  echo "FAIL: Contents.json does not reference AppIcon-60x60@2x.png (120x120)"
  exit 1
fi
echo "OK  : Contents.json references the 120x120 iPhone icon"

# --- Step 6: List all generated files for build log visibility ---
echo ""
echo "--- Generated files in $OUT_DIR ---"
ls -la "$OUT_DIR"

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "OK: Generated and verified complete opaque iOS AppIcon.appiconset in $OUT_DIR"
