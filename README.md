# Atom Eats Production Planner

Internal production planning website for Atom Eats, at https://production.atomeats.com.

- Website: React + Vite + Tailwind, published to GitHub Pages on every push to `main`.
- Data: a separate Supabase project (`atom-eats-production`). Keys live in GitHub secrets, never in this repo.
- Recipes, stock sheets and other business files are kept outside this repo.

## Backups

- Every Sunday 3 am IST a GitHub Action (`.github/workflows/backup.yml`) copies the database (schemas `public`, `auth`, `supabase_migrations`), compresses it, locks it with a password and saves it to Google Drive → **Atom Eats Production Backups**. The last 13 weeks are kept. It can also be run by hand: GitHub → Actions → Weekly backup → Run workflow.
- Nothing is stored on GitHub: no artifacts; the log only shows the file size.
- Secrets (GitHub → Settings → Secrets): `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `RCLONE_DRIVE_TOKEN` (Drive access limited to files this backup creates).
- **The backup password is kept by Jay** (not in this repo). Without it a backup can't be opened.
- To open a backup: download the `.sql.gz.enc` file, then
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FILE.sql.gz.enc | gunzip > backup.sql`
  (it asks for the backup password). `backup.sql` can be loaded into a fresh Supabase project with `psql`.
