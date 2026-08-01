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

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

# Remove only the PNG files and Contents.json so the asset catalog folder
# itself is preserved. This prevents breaking the native asset catalog.
rm -f *.png Contents.json

# --- Step 1: Create an opaque master copy ---
# sips can leave an alpha channel in the resized output. We flatten the
# source onto an opaque white background first so every derived icon is
# guaranteed to have no transparency.
TEMP_SOURCE="$(mktemp -d)/icon_opaque.png"
sips -s format png "$SOURCE" --out "$TEMP_SOURCE" >/dev/null 2>&1
# Remove alpha channel by setting hasAlpha to false.
sips -s hasAlpha false "$TEMP_SOURCE" >/dev/null 2>&1 || true

# --- Step 2: Resize into every required size ---
# Each file is a real, independent PNG — no symlinks.
resize() {
  local size="$1"
  local name="$2"
  if ! sips -z "$size" "$size" "$TEMP_SOURCE" --out "$name" >/dev/null 2>&1; then
    echo "ERROR: Failed to resize icon to ${size}x${size} ($name)"
    exit 1
  fi
  # Force opacity on the resized file too (belt and suspenders).
  sips -s hasAlpha false "$name" >/dev/null 2>&1 || true
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

# Cleanup
rm -f "$(dirname "$TEMP_SOURCE")/icon_opaque.png"
rmdir "$(dirname "$TEMP_SOURCE")" 2>/dev/null || true

echo "OK: Generated and verified complete opaque iOS AppIcon.appiconset in $OUT_DIR"
