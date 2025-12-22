import http from 'http';
import zlib from 'zlib';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const baseUrl = 'http://localhost:8000/africa';
const tilesToTry = [
    { z: 0, x: 0, y: 0 },
    { z: 1, x: 0, y: 0 },
    { z: 1, x: 1, y: 0 },
    { z: 1, x: 0, y: 1 },
    { z: 1, x: 1, y: 1 },
    { z: 2, x: 2, y: 2 }
];

function checkTile(z, x, y) {
    return new Promise((resolve) => {
        const url = `${baseUrl}/${z}/${x}/${y}.mvt`;
        console.log(`Trying ${url}...`);
        http.get(url, (res) => {
            if (res.statusCode !== 200) {
                console.log(`  -> Status ${res.statusCode}`);
                resolve(null);
                return;
            }
            
            const isGzip = res.headers['content-encoding'] === 'gzip' || 
                           res.headers['content-type'] === 'application/x-protobuf; gzip'; // Some servers are weird

            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                let buffer = Buffer.concat(chunks);
                
                // Auto-detect gzip magic number (1f 8b)
                if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
                    console.log('  -> Detected GZIP content, decompressing...');
                    try {
                        buffer = zlib.gunzipSync(buffer);
                    } catch (e) {
                        console.log('  -> GZIP decompression failed:', e.message);
                        resolve(null);
                        return;
                    }
                }

                try {
                    const pbf = new Pbf(buffer);
                    const tile = new VectorTile(pbf);
                    const layers = Object.keys(tile.layers);
                    console.log(`  -> SUCCESS! Layers found: ${JSON.stringify(layers)}`);
                    resolve(layers);
                } catch (e) {
                    console.log(`  -> Error decoding PBF: ${e.message}`);
                    console.log(`  -> First 20 bytes: ${buffer.slice(0, 20).toString('hex')}`);
                    console.log(`  -> As string: ${buffer.slice(0, 50).toString().replace(/[^\x20-\x7E]/g, '.')}`);
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            console.log(`  -> Network error: ${e.message}`);
            resolve(null);
        });
    });
}

async function run() {
    for (const t of tilesToTry) {
        const layers = await checkTile(t.z, t.x, t.y);
        if (layers && layers.length > 0) {
            console.log('\n---------------------------------------------------');
            console.log('Please use one of these names in your "layerName" config:');
            console.log(layers.join(', '));
            console.log('---------------------------------------------------');
            return;
        }
    }
    console.log('\nCould not find any valid tiles or layers. Please check your server URL.');
}

run();

