import os
import urllib.request
import time

# Configuration
FONT_NAME = "Open Sans Regular"
BASE_URL = "https://github.com/openmaptiles/fonts/raw/master/Open%20Sans%20Regular"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "fonts", FONT_NAME)

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

print(f"Downloading {FONT_NAME} to {OUTPUT_DIR}...")

# Download first 5 ranges (covers most Western languages)
# For Chinese, you need a different font (Noto Sans CJK) and many more ranges.
for i in range(0, 5):
    start = i * 256
    end = start + 255
    filename = f"{start}-{end}.pbf"
    url = f"{BASE_URL}/{filename}"
    filepath = os.path.join(OUTPUT_DIR, filename)
    
    if os.path.exists(filepath):
        print(f"Skipping {filename}")
        continue
        
    try:
        print(f"Downloading {filename}...")
        urllib.request.urlretrieve(url, filepath)
        time.sleep(0.2)
    except Exception as e:
        print(f"Error: {e}")

print("Done.")
