# Mujtaba Manzoor — Portfolio Website

Personal portfolio for Mujtaba Manzoor, documentary filmmaker and photographer from Kashmir. The site showcases films, documentaries, NGO works, and photography, with a contact form and a hero video.

Live at [mujtabamanzoor.com](https://mujtabamanzoor.com)

## Overview

The site is a static single-page portfolio. Media (videos and photos) is organized into folders, and a small Python script scans those folders to build a manifest that the page reads to populate galleries — handling renaming, thumbnail generation, and image compression along the way.

The site is self-hosted via the included Docker + Caddy setup.

## Contact form

The contact form sends through SMTP, configured via environment variables (Gmail account, app password, and recipient address). It's handled by a separate admin server project.

## Requirements

- Python + Pillow for the manifest/media script
- ffmpeg for video thumbnails
- Docker, for self-hosted deployment
