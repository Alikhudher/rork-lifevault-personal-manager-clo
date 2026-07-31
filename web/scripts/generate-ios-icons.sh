#!/bin/bash
# Generate an iPhone AppIcon.appiconset from web/public/icon.png (1024x1024).
# Run during the Codemagic iOS build after `bunx cap sync ios` so the native
# asset catalog is replaced with the finalized LifeVault icon.
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

# Remove the Capacitor placeholder icons so the old blue-X/template icon
# cannot be accidentally included in the IPA.
rm -f *.png Contents.json

resize() {
  local size="$1"
  local name="$2"
  if ! sips -z "$size" "$size" "$SOURCE" --out "$name" >/dev/null 2>&1; then
    echo "ERROR: Failed to resize icon to ${size}x${size} ($name)"
    exit 1
  fi
}

# iPhone-only sizes (the app is TARGETED_DEVICE_FAMILY = 1).
# 20pt
resize 40  AppIcon-20x20@2x.png
resize 60  AppIcon-20x20@3x.png
# 29pt
resize 58  AppIcon-29x29@2x.png
resize 87  AppIcon-29x29@3x.png
# 40pt
resize 80  AppIcon-40x40@2x.png
resize 120 AppIcon-40x40@3x.png
# 60pt (2x is the same 120px as 40pt 3x; 3x is 180px)
ln -sf AppIcon-40x40@3x.png AppIcon-60x60@2x.png
resize 180 AppIcon-60x60@3x.png
# App Store marketing icon
resize 1024 AppIcon-1024x1024@1x.png

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

echo "OK: Generated iPhone AppIcon.appiconset in $OUT_DIR"
