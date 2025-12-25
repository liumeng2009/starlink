import json
import os

# Update tileserver-style.json
style_path = r'd:\webgl\starlink\tools\tileserver-style.json'
with open(style_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace all occurrences of the old source name with a generic one
new_content = content.replace('africa-source', 'openmaptiles')

with open(style_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

# Update tileserver-config.json
config_path = r'd:\webgl\starlink\tools\tileserver-config.json'
with open(config_path, 'r', encoding='utf-8') as f:
    config = json.load(f)

# Rename style key from 'africa' to 'basic' if it exists
if 'styles' in config and 'africa' in config['styles']:
    config['styles']['basic'] = config['styles'].pop('africa')

# Set the data source to 'openmaptiles' with the user's path
mbtiles_path = "d:/world-map/central_america.osm.mbtiles"

config['data'] = {
    "openmaptiles": {
        "mbtiles": mbtiles_path
    }
}

with open(config_path, 'w', encoding='utf-8') as f:
    json.dump(config, f, indent=2)

print("Configuration updated successfully.")
