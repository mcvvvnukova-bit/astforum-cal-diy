import datetime, json, os, pathlib, shutil, subprocess

root = pathlib.Path('/opt/astforum-cal-diy')
revision = 'e62aef037860a2ff393a6a131a226bd7c00b4114'
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = root / 'backups' / ('smtp-reminders-' + stamp)
backup.mkdir(mode=0o700)
os.umask(0o077)
shutil.copy2(root / '.env', backup / 'environment.before')
shutil.copy2(root / 'source/deployment/astforum/compose.yaml', backup / 'compose.before.yaml')
old_override = root / 'releases/91c17f5baad61d7f729a37dc437f00eb54628401/web-command.override.yaml'
shutil.copy2(old_override, backup / 'web-command.before.yaml')
containers = json.loads(subprocess.check_output(['docker','inspect',*subprocess.check_output(['docker','ps','-q'],text=True).split()],text=True))
neighbors = [{ 'name': c['Name'], 'id': c['Id'], 'startedAt': c['State']['StartedAt'] }
  for c in containers if c['Name'] != '/astforum-cal-diy-web-1' and not c['Name'].startswith(('/cal-reminders-build.', '/forum-reminder-'))]
(backup / 'neighbors.before.json').write_text(json.dumps(neighbors,indent=2))
web = next(c for c in containers if c['Name'] == '/astforum-cal-diy-web-1')
(backup / 'web.before.json').write_text(json.dumps(web,indent=2))
with (backup / 'caldiy.before.dump').open('wb') as output:
 subprocess.run(['docker','exec','astforum-cal-diy-database-1','pg_dump','-U','caldiy','-d','caldiy','-Fc'],stdout=output,check=True)
query = 'SELECT COALESCE(json_agg(t),\'[]\') FROM (SELECT id, uid, status, "startTime", "endTime", "updatedAt", "eventTypeId", rescheduled FROM "Booking" ORDER BY id) t;'
(backup / 'bookings.before.json').write_bytes(subprocess.check_output(['docker','exec','astforum-cal-diy-database-1','psql','-U','caldiy','-d','caldiy','-At','-c',query]))
subprocess.run(['docker','exec','-i','astforum-cal-diy-database-1','pg_restore','-l'],input=(backup / 'caldiy.before.dump').read_bytes(),stdout=subprocess.DEVNULL,check=True)
release = root / 'releases' / revision
release.mkdir(mode=0o700,exist_ok=True)
subprocess.run(['git','clone','--quiet','--depth','1','--branch','codex/smtp-booking-reminders','https://github.com/mcvvvnukova-bit/astforum-cal-diy.git',str(release / 'source')],check=True)
actual = subprocess.check_output(['git','-C',str(release / 'source'),'rev-parse','HEAD'],text=True).strip()
assert actual == revision, actual
(release / 'backup.path').write_text(str(backup)+'\n')
for name in ('Dockerfile.release','build-release.sh'):
 shutil.copy2(pathlib.Path('/home/testing-user/cal-reminders-build.DIBF4g') / name, release / name)
print(json.dumps({'backup':str(backup),'release':str(release),'sourceRevision':actual,'neighborContainers':len(neighbors),'databaseBackupValidated':True}))
