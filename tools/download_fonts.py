import os
import requests

# Configuration
FONT_NAME = "Open Sans Regular"
BASE_URL = "https://github.com/openmaptiles/fonts/raw/master/Open%20Sans%20Regular"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "fonts", FONT_NAME)

# Create directory
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

print(f"Downloading {FONT_NAME} to {OUTPUT_DIR}...")

# Download ranges (0-255 is essential, others are optional but good to have)
# For a full offline experience, we should download all, but that's 65k files if we do single bytes? 
# No, they are ranges of 256. So 0-255, 256-511... 65535. Total 256 files.
for i in range(0, 256):
    start = i * 256
    end = start + 255
    filename = f"{start}-{end}.pbf"
    url = f"{BASE_URL}/{filename}"
    filepath = os.path.join(OUTPUT_DIR, filename)
    
    if os.path.exists(filepath):
        print(f"Skipping {filename} (already exists)")
        continue
        
    try:
        print(f"Downloading {filename}...")
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(response.content)
        else:
            print(f"Failed to download {filename}: Status {response.status_code}")
    except Exception as e:
        print(f"Error downloading {filename}: {e}")

print("Download complete.")
