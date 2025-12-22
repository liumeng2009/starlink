<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Snddb7-8nA-scNJTZL2JMWAXlgVEjAlQ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Local Map Services Setup (Dual-Service Architecture)

Since we are using `.pmtiles` (efficient archive) but need `.png` (raster tiles) for performance:

1.  **Service 1: Data Provider (Port 8000)**
    *   Serves the raw vector data from the `.pmtiles` file.
    *   Command: `pmtiles serve "D:\world-map\pmtiles" --port 8000 --cors "*"`
    *   *Note: Adjust the path to where your africa.pmtiles is located.*

2.  **Service 2: Renderer (Port 8001)**
    *   Consumes vector data from Service 1 and renders it to PNG images.
    *   Command: `tileserver-gl-light -c tools/tileserver-config.json --port 8001`

**Start both terminals before running the app.**
