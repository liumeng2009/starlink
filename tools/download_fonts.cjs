const fs = require('fs');
const path = require('path');
const https = require('https');

const FONT_NAME = "Open Sans Semibold";
const BASE_URL = "https://demotiles.maplibre.org/font/Open%20Sans%20Semibold";
const OUTPUT_DIR = path.join(__dirname, "fonts", FONT_NAME);

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log(`Downloading ${FONT_NAME} to ${OUTPUT_DIR}...`);

// 0 - 20
const ranges = Array.from(Array(256).keys());

function downloadFile(index) {
    if (index >= ranges.length) {
        console.log("Done.");
        return;
    }

    const i = ranges[index];
    const start = i * 256;
    const end = start + 255;
    const filename = `${start}-${end}.pbf`;
    const url = `${BASE_URL}/${filename}`;
    console.log(url);
    const filepath = path.join(OUTPUT_DIR, filename);

    if (fs.existsSync(filepath)) {
        console.log(`Skipping ${filename}`);
        downloadFile(index + 1);
        return;
    }

    console.log(`Downloading ${filename}...`);
    const file = fs.createWriteStream(filepath);
    
    // Follow redirects if necessary (GitHub raw usually redirects)
    const request = https.get(url, function(response) {
        if (response.statusCode === 302 || response.statusCode === 301) {
            https.get(response.headers.location, function(redirectResponse) {
                redirectResponse.pipe(file);
                file.on('finish', function() {
                    file.close(() => downloadFile(index + 1));
                });
            });
        } else {
            response.pipe(file);
            file.on('finish', function() {
                file.close(() => downloadFile(index + 1));
            });
        }
    }).on('error', function(err) {
        fs.unlink(filepath, () => {}); // Delete the file async
        console.error(`Error downloading ${filename}: ${err.message}`);
        downloadFile(index + 1);
    });
}

downloadFile(0);
