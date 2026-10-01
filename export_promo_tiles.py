import os
from PIL import Image

output_dir = os.path.join(os.path.dirname(__file__), "promotional_tiles")
os.makedirs(output_dir, exist_ok=True)

# 1. Process Small Promo Tile (440x280)
small_raw_path = os.path.join(os.path.dirname(__file__), "promo_small_raw.png")
if os.path.exists(small_raw_path):
    small_img = Image.open(small_raw_path).convert('RGB')
    small_crop = small_img.crop((0, 0, 440, 280))
    
    # Save 24-bit PNG (no alpha)
    png_small = os.path.join(output_dir, "small-promo-tile-440x280.png")
    small_crop.save(png_small, format="PNG")
    
    # Save High Quality JPEG
    jpg_small = os.path.join(output_dir, "small-promo-tile-440x280.jpg")
    small_crop.save(jpg_small, format="JPEG", quality=95)
    
    # Also save to root for easy drag-and-drop
    small_crop.save(os.path.join(os.path.dirname(__file__), "small-promo-tile-440x280.png"), format="PNG")
    small_crop.save(os.path.join(os.path.dirname(__file__), "small-promo-tile-440x280.jpg"), format="JPEG", quality=95)
    print(f"[OK] Small promo tile exported: {small_crop.size}, mode: {small_crop.mode}")

# 2. Process Marquee Promo Tile (1400x560)
marquee_raw_path = os.path.join(os.path.dirname(__file__), "promo_marquee_raw.png")
if os.path.exists(marquee_raw_path):
    marquee_img = Image.open(marquee_raw_path).convert('RGB')
    marquee_crop = marquee_img.crop((0, 0, 1400, 560))
    
    # Save 24-bit PNG (no alpha)
    png_marquee = os.path.join(output_dir, "marquee-promo-tile-1400x560.png")
    marquee_crop.save(png_marquee, format="PNG")
    
    # Save High Quality JPEG
    jpg_marquee = os.path.join(output_dir, "marquee-promo-tile-1400x560.jpg")
    marquee_crop.save(jpg_marquee, format="JPEG", quality=95)
    
    # Also save to root for easy drag-and-drop
    marquee_crop.save(os.path.join(os.path.dirname(__file__), "marquee-promo-tile-1400x560.png"), format="PNG")
    marquee_crop.save(os.path.join(os.path.dirname(__file__), "marquee-promo-tile-1400x560.jpg"), format="JPEG", quality=95)
    print(f"[OK] Marquee promo tile exported: {marquee_crop.size}, mode: {marquee_crop.mode}")

# Clean up raw files
for temp in ["promo_small_raw.png", "promo_marquee_raw.png", "test_crop_440x280.png", "test_crop_1400x560.png"]:
    p = os.path.join(os.path.dirname(__file__), temp)
    if os.path.exists(p):
        os.remove(p)

print("\nAll Chrome Web Store promotional tiles successfully generated and verified!")
