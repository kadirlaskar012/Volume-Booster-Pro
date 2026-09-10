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

# Path to the source image (the new professional light icon)
SOURCE_IMAGE = r"C:\Users\KadiR-PC\.gemini\antigravity-ide\brain\b21d07ed-4d36-4f79-8152-3f4e08d8440d\vbp_pro_icon_light_1789028350437.jpg"

# Output directory
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Required icon sizes for Chrome extensions
SIZES = [16, 32, 48, 128]

def generate_icons():
    from PIL import ImageDraw, ImageEnhance
    print(f"Loading source image: {SOURCE_IMAGE}")
    
    if not os.path.exists(SOURCE_IMAGE):
        print(f"ERROR: Source image not found at {SOURCE_IMAGE}")
        sys.exit(1)
    
    img = Image.open(SOURCE_IMAGE)
    crop = img.crop((195, 190, 830, 825)).resize((512, 512), Image.LANCZOS).convert('RGBA')

    # Anti-aliased rounded squircle mask
    mask = Image.new('L', (1024, 1024), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (1024, 1024)], radius=220, fill=255)
    mask = mask.resize((512, 512), Image.LANCZOS)
    crop.putalpha(mask)
    
    for size in SIZES:
        resized = crop.resize((size, size), Image.LANCZOS)
        if size in [16, 32]:
            resized = ImageEnhance.Sharpness(resized).enhance(2.0)
        output_path = os.path.join(OUTPUT_DIR, f"icon{size}.png")
        resized.save(output_path, "PNG")
        print(f"  ✓ Created icons/icon{size}.png ({size}×{size})")
    
    print("\n✅ All professional light icons generated successfully!")
    print(f"   Output directory: {OUTPUT_DIR}")

if __name__ == "__main__":
    generate_icons()
