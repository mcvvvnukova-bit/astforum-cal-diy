import json, pathlib, subprocess, sys

revision = sys.argv[1]
assert len(revision) == 40 and all(c in '0123456789abcdef' for c in revision)
root = pathlib.Path('/opt/astforum-cal-diy')
parent_release = root / 'releases/e62aef037860a2ff393a6a131a226bd7c00b4114'
release = root / 'releases' / revision
release.mkdir(mode=0o700)
source = release / 'source'
subprocess.run(['git','clone','--quiet','--depth','1','--branch','codex/smtp-booking-reminders','https://github.com/mcvvvnukova-bit/astforum-cal-diy.git',str(source)],check=True)
assert subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip() == revision
(release / 'backup.path').write_text((parent_release / 'backup.path').read_text())
base = 'astforum/cal-diy:e62aef037860'
assert subprocess.check_output(['docker','image','inspect',base,'--format','{{.Id}}'],text=True).strip() == 'sha256:babbcdb86efdf10990785f3bc94f2242969bc94ec1e6e086fea2400de8935e42'
build = release / 'runtime-build'
build.mkdir(mode=0o700)
(build / 'turbo.json').write_bytes((source / 'turbo.json').read_bytes())
(build / 'configuration.test.ts').write_bytes((source / 'packages/features/bookings/reminders/configuration.test.ts').read_bytes())
(build / 'Dockerfile').write_text('''FROM astforum/cal-diy:e62aef037860
COPY turbo.json /calcom/turbo.json
COPY configuration.test.ts /calcom/packages/features/bookings/reminders/configuration.test.ts
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF org.opencontainers.image.base.name="astforum/cal-diy:e62aef037860" org.opencontainers.image.base.digest="sha256:babbcdb86efdf10990785f3bc94f2242969bc94ec1e6e086fea2400de8935e42"
''')
image = 'astforum/cal-diy:' + revision[:12]
with (release / 'runtime-build.log').open('w') as output:
 subprocess.run(['docker','build','--progress','plain','--build-arg','VCS_REF='+revision,'-t',image,str(build)],stdout=output,stderr=subprocess.STDOUT,check=True)
print(json.dumps({'sourceRevision':revision,'image':image,'release':str(release),'unchangedApplicationBuild':'e62aef0'}))
