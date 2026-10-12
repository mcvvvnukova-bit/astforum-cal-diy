import json, os, pathlib, secrets, subprocess, sys

root = pathlib.Path('/opt/astforum-cal-diy')
revision = sys.argv[1] if len(sys.argv) > 1 else 'e62aef037860a2ff393a6a131a226bd7c00b4114'
release = root / 'releases' / revision
image = 'astforum/cal-diy:' + revision[:12]
metadata = json.loads(subprocess.check_output(['docker','image','inspect',image],text=True))[0]
assert metadata['Config']['Labels']['org.opencontainers.image.revision'] == revision
assert metadata['Config']['Labels']['org.opencontainers.image.licenses'] == 'MIT'
assert metadata['Architecture'] == 'amd64'
subprocess.run(['docker','run','--rm','--entrypoint','sh',image,'-c','test -s /calcom/apps/web/.next/server/app/api/tasks/cron/route.js'],check=True)
env_path = root / '.env'
lines = env_path.read_text().splitlines()
existing = {line.split('=',1)[0]: line.split('=',1)[1] for line in lines if '=' in line and not line.lstrip().startswith('#')}
updates = {'CALDIY_IMAGE':image,'CRON_SECRET':existing.get('CRON_SECRET') or secrets.token_hex(32),'BOOKING_REMINDER_EVENT_TYPE_IDS':'3'}
updated = [line for line in lines if line.split('=',1)[0] not in updates]
updated.extend(key+'='+value for key,value in updates.items())
os.umask(0o077)
temporary = root / '.env.reminders-new'
temporary.write_text('\n'.join(updated)+'\n')
temporary.chmod(0o600)
temporary.replace(env_path)
override = release / 'web-command.override.yaml'
override.write_text('services:\n  web:\n    image: '+image+'\n    command: ["yarn", "start"]\n')
compose = ['docker','compose','--env-file',str(env_path),'-f',str(release / 'source/deployment/astforum/compose.yaml'),'-f',str(override),'--profile','reminders']
subprocess.run(compose+['config','--quiet'],check=True)
(release / 'active-image.json').write_text(json.dumps({'image':image,'imageId':metadata['Id'],'sourceRevision':revision},indent=2)+'\n')
subprocess.run(compose+['up','-d','--no-deps','web'],check=True)
print(json.dumps({'phase':'web-replaced','image':image,'sourceRevision':revision,'eventTypeAllowlist':'3'}))
