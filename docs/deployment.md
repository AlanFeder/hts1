# Deployment

Live at: **https://hts.alanfeder.com**

Not indexed by search engines (robots.txt + noindex meta tag). Share the URL directly.

---

## Infrastructure

| Component | Details |
|---|---|
| VM | GCP Compute Engine `e2-micro`, `us-central1-a`, project `project-misc-1` |
| Instance name | `instance-20260405-210533` |
| External IP | `34.170.120.101` (static) |
| OS | Ubuntu 22.04 LTS |
| Web server | nginx (reverse proxy + static file serving) |
| SSL | Let's Encrypt via certbot (auto-renewing, expires 2026-07-04) |
| Process manager | systemd (`hts.service`) |
| DNS | Namecheap — A record `hts` → `34.170.120.101` |

**Cost:** ~$1–2/month (disk + egress only; e2-micro compute is GCP free tier)

---

## SSH access

```bash
gcloud compute ssh instance-20260405-210533 --zone=us-central1-a
```

---

## Deploying updates

From your local Mac:

```bash
# 1. Sync changed source files (excludes data, venv, node_modules)
rsync -av --exclude='data/chroma' --exclude='data/hts_raw.json' \
  --exclude='data/hts_processed.json' --exclude='__pycache__' \
  --exclude='.venv' --exclude='frontend/node_modules' \
  ~/Documents/projects/hts_classifier/ \
  alanfeder@34.170.120.101:~/hts_classifier/

# 2. If frontend changed — rebuild locally first, then sync dist
cd ~/Documents/projects/hts_classifier/frontend
npm run build
rsync -av frontend/dist/ alanfeder@34.170.120.101:~/hts_classifier/frontend/dist/

# 3. If backend Python changed — restart the service on the VM
gcloud compute ssh instance-20260405-210533 --zone=us-central1-a
sudo systemctl restart hts
```

---

## Service management (on the VM)

```bash
sudo systemctl status hts       # check status
sudo systemctl restart hts      # restart after code changes
sudo systemctl stop hts         # stop
sudo journalctl -u hts -f       # tail live logs
sudo journalctl -u hts -n 50    # last 50 log lines
```

The service starts automatically on VM reboot.

---

## Architecture

```
Browser → https://hts.alanfeder.com
       → nginx (port 443, SSL)
            ├── GET /          → serves frontend/dist/ (static React build)
            ├── POST /classify → proxy → uvicorn :8000 (FastAPI)
            └── GET /health    → proxy → uvicorn :8000
```

nginx config: `/etc/nginx/sites-available/hts`

FastAPI runs via systemd as:
```
uvicorn hts_classifier.app:app --host 0.0.0.0 --port 8000 --workers 2
```

No `--reload` flag in production (dev-only; causes slowdown).

---

## Key files on the VM

| Path | Purpose |
|---|---|
| `/etc/systemd/system/hts.service` | systemd unit |
| `/etc/nginx/sites-available/hts` | nginx config |
| `/etc/letsencrypt/live/hts.alanfeder.com/` | SSL cert |
| `~/hts_classifier/data/chroma/` | ChromaDB (do not delete) |
| `~/hts_classifier/frontend/dist/` | Built React app |

---

## Startup behavior

On service start, the app:
1. Loads HTS data from `data/hts_processed.json` (~1–2s)
2. Connects to ChromaDB (~2s)
3. Runs a warmup embed call to pre-initialize the Vertex AI client (~2s)

Total cold start: ~5–7 seconds. After that, embeddings requests are fast; LLM-based methods (GAR, rerank, agentic) depend on Vertex AI latency.

---

## Vertex AI credentials

The VM uses Application Default Credentials (`gcloud auth application-default login`), which were configured once at setup. These are stored at `~/.config/gcloud/application_default_credentials.json` and do not expire.

If credentials ever stop working:
```bash
gcloud auth application-default login
sudo systemctl restart hts
```
