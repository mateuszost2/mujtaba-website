import os
import json
import subprocess
import urllib.request
import urllib.error
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

VIDEO_EXT = {'.mp4', '.mov', '.webm'}
IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp'}
VIMEO_STATE_PATH = 'vimeo_state.json'
VIMEO_ACCESS_TOKEN = os.getenv('VIMEO_ACCESS_TOKEN')
VIMEO_USER = os.getenv('VIMEO_USER')

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

def compress_thumbnail(thumb_path, max_width=640):
    try:
        img = Image.open(thumb_path)
        if img.width > max_width:
            ratio = max_width / img.width
            new_size = (max_width, int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        img.convert('RGB').save(thumb_path, 'JPEG', quality=75, optimize=True)
        print(f'  compressed thumb: {os.path.basename(thumb_path)}')
    except Exception as e:
        print(f'  error compressing thumb: {e}')

def sanitize(filename):
    name, ext = os.path.splitext(filename)
    name = name.lower()
    name = name.replace('–', '_').replace('—', '_').replace('-', '_')
    name = ''.join(c if c.isalnum() or c == '_' else '_' for c in name)
    name = '_'.join(filter(None, name.split('_')))
    return name + ext.lower()

def rename_if_needed(folder_path, filename):
    new_name = sanitize(filename)
    if new_name != filename:
        src = os.path.join(folder_path, filename)
        dst = os.path.join(folder_path, new_name)
        if not os.path.exists(dst):
            os.rename(src, dst)
            print(f'  renamed: {filename} → {new_name}')
        return new_name
    return filename

def process_video_folder(folder_path):
    if not os.path.exists(folder_path):
        return []
    thumb_dir = os.path.join(folder_path, 'thumbnails')
    os.makedirs(thumb_dir, exist_ok=True)
    files = sorted([
        f for f in os.listdir(folder_path)
        if os.path.splitext(f)[1].lower() in VIDEO_EXT
    ])
    print(f'\n{folder_path}:')
    for f in files:
        f = rename_if_needed(folder_path, f)
        video_path = os.path.join(folder_path, f)
        thumb_path = os.path.join(thumb_dir, os.path.splitext(f)[0] + '.jpg')
        generate_thumbnail(video_path, thumb_path)
        compress_thumbnail(thumb_path)

    return [rename_if_needed(folder_path, f) for f in os.listdir(folder_path) if os.path.splitext(f)[1].lower() in VIDEO_EXT]

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
        f = rename_if_needed(folder_path, f)
        src = os.path.join(folder_path, f)
        dest = os.path.join(compressed_dir, os.path.splitext(f)[0] + '.jpg')
        compress_photo(src, dest)
    return sorted([rename_if_needed(folder_path, f) for f in os.listdir(folder_path) if os.path.splitext(f)[1].lower() in IMAGE_EXT])

# ── Load existing manifest (to preserve custom fields) ──
def load_existing_manifest():
    if os.path.exists('manifest.json'):
        with open('manifest.json', 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except:
                return {}
    return {}

# ── Vimeo profile auto-pull (authenticated, public-scope token) ──
# vimeo_state.json persists per-video category + any manual title/description
# overrides across runs — the only thing a human (or, later, the admin panel)
# needs to touch is the "category" field for newly discovered videos, which
# default to "none" until assigned.
def load_vimeo_state():
    if os.path.exists(VIMEO_STATE_PATH):
        with open(VIMEO_STATE_PATH, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except:
                return {}
    return {}

def save_vimeo_state(state):
    with open(VIMEO_STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=2, ensure_ascii=False)

def best_thumb(pictures):
    sizes = (pictures or {}).get('sizes') or []
    if not sizes:
        return ''
    return sorted(sizes, key=lambda s: s.get('width', 0))[len(sizes) // 2].get('link', '')

def fetch_vimeo_profile_videos(token, user):
    videos = []
    fields = 'uri,name,description,pictures.sizes.link,pictures.sizes.width'
    url = f'https://api.vimeo.com/users/{user}/videos?per_page=100&fields={fields}'
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.vimeo.*+json;version=3.4',
    }
    while url:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.load(resp)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            print(f'  vimeo api error: {e}')
            break
        for v in data.get('data', []):
            vimeo_id = v.get('uri', '').split('/')[-1]
            if not vimeo_id:
                continue
            videos.append({
                'vimeoId': vimeo_id,
                'title': v.get('name') or '',
                'description': v.get('description') or '',
                'thumb': best_thumb(v.get('pictures')),
            })
        nxt = (data.get('paging') or {}).get('next')
        url = f'https://api.vimeo.com{nxt}' if nxt else None
    return videos

def enrich_vimeo_profile():
    if not VIMEO_ACCESS_TOKEN or not VIMEO_USER:
        return {}
    state = load_vimeo_state()
    fetched = fetch_vimeo_profile_videos(VIMEO_ACCESS_TOKEN, VIMEO_USER)
    print(f'\nvimeo profile ({VIMEO_USER}): {len(fetched)} video(s)')
    by_category = {}
    for v in fetched:
        vimeo_id = v['vimeoId']
        entry = state.setdefault(vimeo_id, {'category': 'none', 'title': '', 'year': '', 'role': '', 'description': ''})
        item = {
            'filename': None,
            'title': entry.get('title') or v['title'],
            'year': entry.get('year', ''),
            'role': entry.get('role', ''),
            'description': entry.get('description') or v['description'],
            'thumb': v['thumb'],
            'src': f'vimeo:{vimeo_id}',
        }
        by_category.setdefault(entry.get('category') or 'none', []).append(item)
    save_vimeo_state(state)
    return by_category

# ── Build manifest ──
metadata = load_metadata()
existing_manifest = load_existing_manifest()

def enrich(files, folder, thumb_folder=None):
    result = []
    for f in files:
        meta = metadata.get(f, {})
        sanitized = sanitize(f)
        basename = os.path.splitext(sanitized)[0]
        # Local Hetzner-hosted HLS fallback — intentionally kept as-is alongside
        # the Vimeo path below. Not touched by the Vimeo migration.
        hls_path = f"{folder}/hls/{basename}/{basename}.m3u8"
        src = hls_path if os.path.exists(hls_path) else f"{folder}/{sanitized}"
        result.append({
            'filename': sanitized,
            'title': meta.get('title', ''),
            'year': meta.get('year', ''),
            'role': meta.get('role', ''),
            'description': meta.get('description', ''),
            'thumb': (thumb_folder or folder) + '/' + basename + '.jpg',
            'src': src,
        })
    return result

docs_files         = process_video_folder('videos/documentaries')
ngo_files          = process_video_folder('videos/ngo_works')
travel_files       = process_video_folder('videos/travel_films')
main_files         = scan_folder('videos/main_video', VIDEO_EXT)
photos_files       = process_photo_folder('pictures/documentary_photography')
about_files        = scan_folder('pictures/about_me_pic', IMAGE_EXT)

vimeo_by_category = enrich_vimeo_profile()

manifest = {
    'documentaries': enrich(docs_files,   'videos/documentaries', 'videos/documentaries/thumbnails') + vimeo_by_category.get('documentaries', []),
    'ngo_works':     enrich(ngo_files,    'videos/ngo_works',     'videos/ngo_works/thumbnails')     + vimeo_by_category.get('ngo_works', []),
    'travel_films':  enrich(travel_files, 'videos/travel_films',  'videos/travel_films/thumbnails')  + vimeo_by_category.get('travel_films', []),
    'main_video':    enrich(main_files,   'videos/main_video'),
    'photos':        enrich(photos_files, 'pictures/documentary_photography/compressed'),
    'about_img':     about_files,
    'unassigned':    vimeo_by_category.get('none', []),
}

# Preserve custom fields not managed by this script
for key in ('about_text', 'hero_position'):
    if key in existing_manifest:
        manifest[key] = existing_manifest[key]

with open('manifest.json', 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print('\n================================')
print('manifest.json updated:')
for key, val in manifest.items():
    print(f'  {key}: {len(val)} file(s)')
print('================================')