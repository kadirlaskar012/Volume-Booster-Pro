"""
generate_icons.py — Resize the generated icon to required Chrome extension sizes.
Run: python generate_icons.py
Requires Pillow: pip install Pillow
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image

# Path to the source image (the generated icon)
# Update this path to point to the actual generated image
SOURCE_IMAGE = r"C:\Users\KadiR-PC\.gemini\antigravity-ide\brain\b21d07ed-4d36-4f79-8152-3f4e08d8440d\icon128_1789021743727.jpg"

# Output directory
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Required icon sizes for Chrome extensions
SIZES = [16, 32, 48, 128]

def generate_icons():
    print(f"Loading source image: {SOURCE_IMAGE}")
    
    if not os.path.exists(SOURCE_IMAGE):
        print(f"ERROR: Source image not found at {SOURCE_IMAGE}")
        print("Please update SOURCE_IMAGE path in this script.")
        sys.exit(1)
    
    img = Image.open(SOURCE_IMAGE).convert("RGBA")
    
    for size in SIZES:
        resized = img.resize((size, size), Image.LANCZOS)
        output_path = os.path.join(OUTPUT_DIR, f"icon{size}.png")
        resized.save(output_path, "PNG")
        print(f"  ✓ Created icons/icon{size}.png ({size}×{size})")
    
    print("\n✅ All icons generated successfully!")
    print(f"   Output directory: {OUTPUT_DIR}")

if __name__ == "__main__":
    generate_icons()
