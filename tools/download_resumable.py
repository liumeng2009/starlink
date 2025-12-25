import os
import sys
import requests
import time

def download_file_resumable(url, dest_path=None, chunk_size=1024*1024):
    if dest_path is None:
        dest_path = url.split('/')[-1]

    current_size = 0
    mode = 'wb'
    
    if os.path.exists(dest_path):
        current_size = os.path.getsize(dest_path)
        mode = 'ab'
        print(f"Found existing file: {dest_path}, size: {current_size / (1024*1024):.2f} MB")
    
    headers = {}
    if current_size > 0:
        headers['Range'] = f'bytes={current_size}-'
        print(f"Attempting to resume from byte {current_size}...")

    try:
        response = requests.get(url, headers=headers, stream=True, timeout=30)
        
        if response.status_code == 416:
            print("Range not satisfiable. The file might be already fully downloaded.")
            return

        if response.status_code == 206:
            print("Server supports resuming. Continuing download...")
        elif response.status_code == 200:
            if current_size > 0:
                print("Server does NOT support resuming (or sent full file). Restarting download...")
                current_size = 0
                mode = 'wb'
            else:
                print("Starting download...")
        else:
            print(f"Unexpected status code: {response.status_code}")
            response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        if response.status_code == 206:
            total_size += current_size # Content-Length is the remaining part
        
        print(f"Total file size: {total_size / (1024*1024):.2f} MB")

        with open(dest_path, mode) as f:
            start_time = time.time()
            downloaded_in_session = 0
            
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    current_size += len(chunk)
                    downloaded_in_session += len(chunk)
                    
                    # Progress display
                    elapsed = time.time() - start_time
                    speed = downloaded_in_session / elapsed if elapsed > 0 else 0
                    
                    percent = (current_size / total_size) * 100 if total_size > 0 else 0
                    sys.stdout.write(f"\rProgress: {percent:.1f}% | {current_size / (1024*1024):.1f} MB | Speed: {speed / (1024*1024):.2f} MB/s")
                    sys.stdout.flush()
                    
        print("\nDownload complete!")
        
    except KeyboardInterrupt:
        print("\nDownload paused (interrupted by user). Run again to resume.")
    except Exception as e:
        print(f"\nError occurred: {e}")
        print("Run the script again to resume.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python download_resumable.py <URL> [Output Filename]")
        print("Example: python download_resumable.py https://download.geofabrik.de/asia/china-latest.osm.pbf")
    else:
        url = sys.argv[1]
        dest = sys.argv[2] if len(sys.argv) > 2 else None
        download_file_resumable(url, dest)
