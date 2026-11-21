# Database backup and restore

The repository includes `server/scripts/backup-db.ps1` and `server/scripts/restore-db.ps1` for MongoDB Database Tools. Keep production backups encrypted and outside the application host; the scripts do not upload or encrypt archives.

## Backup

Set `MONGODB_URI` in the current PowerShell session without printing it, then run:

```powershell
./server/scripts/backup-db.ps1 -OutputDirectory D:\CashFlowBackups
```

The command writes a gzip archive and a SHA-256 sidecar. Restrict access to the output folder and copy it to encrypted offsite storage. Run a backup on a schedule appropriate to the business and retain more than one recovery point.

## Restore

First restore to an empty staging database and validate the app before restoring production. The script checks the sidecar checksum and requires the explicit `-ConfirmRestore` switch:

```powershell
./server/scripts/restore-db.ps1 -ArchivePath D:\CashFlowBackups\cashflow-YYYYMMDD-HHMMSSZ.archive.gz `
  -TargetUri $env:CASHFLOW_STAGING_URI -ConfirmRestore
```

By default, MongoDB merges restored collections. Add `-DropExistingData` only when intentionally replacing collections in a verified target database. A restore can overwrite live records and cannot be undone. Never use a production URI for a staging rehearsal. After a restore, run `npm run db:check` with the target URI and check the workspace list, ledger counts, and sync status before reopening the app.

The application does not yet run automated scheduled backups or point-in-time recovery. Operators must configure backup scheduling, retention, encryption, access controls, and restore drills on the hosting platform.
