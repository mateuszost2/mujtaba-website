import os
import json
import subprocess
from PIL import Image

VIDEO_EXT = {'.mp4', '.mov', '.webm'}
IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp'}

# ── Load metadata ──
def load_metadata():
    if os.path.exists('metadata.json'):
        with open('metadata.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def scan_folder(path, extensions):
    if not os.path.exists(path):
        return []
    return sorted([
        f for f in os.listdir(path)
        if os.path.splitext(f)[1].lower() in extensions
    ])

def get_video_duration(video_path):
    try:
        result = subprocess.run([
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            video_path
        ], capture_output=True, text=True)
        return float(result.stdout.strip())
    except:
        return None

def generate_thumbnail(video_path, thumb_path):
    if os.path.exists(thumb_path):
        print(f'  skip (exists): {os.path.basename(thumb_path)}')
        return
    duration = get_video_duration(video_path)
    timestamp = duration / 2 if duration else 5
    try:
        subprocess.run([
            'ffmpeg', '-ss', str(timestamp),
            '-i', video_path,
            '-frames:v', '1',
            '-vf', 'scale=640:-1',
            '-q:v', '5',
            '-y', thumb_path
        ], capture_output=True)
        print(f'  generated: {os.path.basename(thumb_path)}')
    except Exception as e:
        print(f'  error: {os.path.basename(video_path)} — {e}')

def process_video_folder(folder_path):
    if not os.path.exists(folder_path):
        return []
    files = sorted([
        f for f in os.listdir(folder_path)
        if os.path.splitext(f)[1].lower() in VIDEO_EXT
    ])
    print(f'\n{folder_path}:')
    for f in files:
        video_path = os.path.join(folder_path, f)
        thumb_path = os.path.join(folder_path, os.path.splitext(f)[0] + '.jpg')
        generate_thumbnail(video_path, thumb_path)
    return files

def compress_photo(src_path, dest_path, max_width=1200):
    if os.path.exists(dest_path):
        print(f'  skip (exists): {os.path.basename(dest_path)}')
        return
    try:
        img = Image.open(src_path)
        if img.width > max_width:
            ratio = max_width / img.width
            new_size = (max_width, int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        img.convert('RGB').save(dest_path, 'JPEG', quality=75, optimize=True)
        print(f'  compressed: {os.path.basename(dest_path)}')
    except Exception as e:
        print(f'  error: {os.path.basename(src_path)} — {e}')

def process_photo_folder(folder_path):
    if not os.path.exists(folder_path):
        return []
    compressed_dir = os.path.join(folder_path, 'compressed')
    os.makedirs(compressed_dir, exist_ok=True)
    files = sorted([
        f for f in os.listdir(folder_path)
        if os.path.splitext(f)[1].lower() in IMAGE_EXT
    ])
    print(f'\n{folder_path}:')
    for f in files:
        src = os.path.join(folder_path, f)
        dest = os.path.join(compressed_dir, os.path.splitext(f)[0] + '.jpg')
        compress_photo(src, dest)
    return files

# ── Build manifest ──
metadata = load_metadata()

def enrich(files, folder):
    result = []
    for f in files:
        meta = metadata.get(f, {})
        result.append({
            'filename': f,
            'title': meta.get('title', ''),
            'year': meta.get('year', ''),
            'role': meta.get('role', ''),
            'description': meta.get('description', ''),
            'thumb': folder + '/' + os.path.splitext(f)[0] + '.jpg',
            'src': folder + '/' + f,
        })
    return result

films_files        = process_video_folder('videos/films')
docs_files         = process_video_folder('videos/documentaries')
ngo_files          = process_video_folder('videos/ngo_works')
main_files         = process_video_folder('videos/main_video')
photos_files       = process_photo_folder('pictures/documentary_photography')
about_files        = scan_folder('pictures/about_me_pic', IMAGE_EXT)

manifest = {
    'films':         enrich(films_files,  'videos/films'),
    'documentaries': enrich(docs_files,   'videos/documentaries'),
    'ngo_works':     enrich(ngo_files,    'videos/ngo_works'),
    'main_video':    enrich(main_files,   'videos/main_video'),
    'photos':        enrich(photos_files, 'pictures/documentary_photography/compressed'),
    'about_img':     about_files,
}

with open('manifest.json', 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print('\n================================')
print('manifest.json updated:')
for key, val in manifest.items():
    print(f'  {key}: {len(val)} file(s)')
print('================================')