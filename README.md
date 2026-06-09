# Mujtaba Manzoor — Portfolio Website

Personal portfolio for Mujtaba Manzoor, documentary filmmaker and photographer from Kashmir. The site showcases films, documentaries, NGO works, and photography, with a contact form and a hero video.

Live at [mujtabamanzoor.com](https://mujtabamanzoor.com)

## Project structure

```
mujtaba-website/
├── index.html                        # Single-page portfolio
├── manifest.json                     # Auto-generated media index (gitignored)
├── metadata.json                     # Titles, years, roles, descriptions per file (gitignored)
├── scripts/
│   ├── generate_manifest.py          # Script that builds manifest.json
│   └── requirements.txt             # Python deps for the script
├── .env                              # SMTP credentials for the contact form (gitignored)
├── pictures/
│   ├── about_me_pic/                 # Profile photo
│   └── documentary_photography/      # Full-res photos + compressed/ subfolder
├── videos/
│   ├── main_video/                   # Hero reel
│   ├── films/                        # Short films
│   ├── documentaries/                # Documentary works
│   └── ngo_works/                    # NGO & social projects
└── docker/
    ├── Dockerfile
    ├── Caddyfile
    └── docker-compose.yaml           # Caddy reverse proxy for self-hosting
```

## How the media pipeline works

The site reads `manifest.json` at runtime to populate all galleries and video sections. You regenerate it whenever you add or rename media files.

**1. Add media files** to the appropriate folder under `videos/` or `pictures/`.

**2. Update `metadata.json`** with titles, years, roles, and descriptions for any new files.

**3. Run the manifest generator:**

```bash
pip install -r scripts/requirements.txt   # first time only
python scripts/generate_manifest.py
```

The script will:
- Rename files to a clean `snake_case` format
- Generate `.jpg` thumbnails for videos using `ffmpeg` (requires `ffmpeg` on PATH)
- Compress photos into `pictures/documentary_photography/compressed/`
- Write `manifest.json`

## Deployment

### GitHub Pages (automatic)

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/static.yml`), which deploys the site to GitHub Pages automatically.

> **Note:** `manifest.json` and `metadata.json` are gitignored. If deploying via GitHub Pages, you need to commit them manually or adjust `.gitignore`.

### Self-hosted with Docker + Caddy

```bash
cd docker
docker compose up -d
```

Caddy serves the parent directory (`../`) over HTTPS. Edit `docker/Caddyfile` to set your domain.

## Contact form

The contact form submits to an admin server (separate repo: `mujtaba-admin`). Configure credentials in `.env`:

| Variable | Description |
|---|---|
| `SMTP_EMAIL` | Gmail account used to send emails |
| `SMTP_PASSWORD` | Gmail App Password |
| `CONTACT_EMAIL` | Address that receives form submissions |

Generate a Gmail App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).

## Requirements

- **Python 3.8+** and `pip` — for running `generate_manifest.py`
- **ffmpeg** — for generating video thumbnails
- **Docker + Compose** — for self-hosted deployment
