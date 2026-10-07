#!/usr/bin/env python3
"""Build a Git-only candidate; write a success receipt only after isolated verification."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

BASE = 'node:24.18.1-bookworm@sha256:19cd848a0e073d34bd8cd5545a1b6b4d28489b3e3b607366621ced442bd5f6b4'
POSTGRES = 'postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
PLATFORM = 'linux/amd64'
NODE_MATERIAL_DIGESTS = {BASE.rsplit('sha256:', 1)[1],
                         '87362b5d965240a1bc79f85cec63179d4ee853741413b274a4721f2742eb8393'}
CHECKS = ('image', 'credentials', 'worker', 'login', 'cron', 'reminders')
INPUTS = ('package.json', 'yarn.lock', '.yarnrc.yml', '.yarn', 'turbo.json', 'i18n.json',
          'apps', 'packages', 'example-apps', 'scripts', 'biome.json', 'biome-staged.json', 'LICENSE', 'deployment/astforum/start.sh',
          'deployment/astforum/reminder-worker.mjs', 'deployment/astforum/Dockerfile.clean')


def command(args, cwd=None, log=None, timeout=9000, live=False):
    output = bytearray()
    deadline = time.monotonic() + timeout
    with subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          start_new_session=True) as process, selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        try:
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError(f'{args[0:3]} exceeded {timeout}s; inspect logs')
                for key, _ in selector.select(min(remaining, 1)):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    output.extend(chunk)
                    if log:
                        with Path(log).open('ab') as stream:
                            stream.write(chunk)
                    if live:
                        sys.stdout.buffer.write(chunk)
                        sys.stdout.buffer.flush()
            try:
                returncode = process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired as error:
                raise RuntimeError(f'{args[0:3]} exceeded {timeout}s; inspect logs') from error
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            raise
    if returncode:
        raise RuntimeError(f'{args[0:3]} failed ({returncode}); inspect preserved logs')
    return output.decode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def snapshot(repo, revision=None):
    git = lambda *args: command(['git', '-C', str(repo), *args]).strip()
    head = git('rev-parse', 'HEAD')
    revision = revision or head
    if not re.fullmatch(r'[0-9a-f]{40}', revision) or revision != head:
        raise ValueError('Revision must be the full current HEAD SHA')
    if git('status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Dirty snapshot; commit or remove task changes first')
    tracked = git('ls-tree', '-r', '--name-only', revision).splitlines()
    if any('/node_modules/' in f'/{p}/' or '/.next/' in f'/{p}/' or
           (Path(p).name.startswith('.env') and not Path(p).name.endswith('.example') and
            not (p == 'packages/lib/test/.env.test' or
                 (p == 'packages/prisma/.env' and git('ls-tree', revision, p).startswith('120000 ')))) for p in tracked):
        raise ValueError('Snapshot contains dependencies, compiled output or private environment')
    for path in INPUTS:
        git('cat-file', '-e', f'{revision}:{path}')
    blob = lambda p: subprocess.check_output(['git', '-C', str(repo), 'show', f'{revision}:{p}'])
    return {'revision': revision, 'tree': git('rev-parse', f'{revision}^{{tree}}'),
            'lock_sha256': digest(blob('yarn.lock')),
            'dockerfile_sha256': digest(blob('deployment/astforum/Dockerfile.clean')),
            'worker_sha256': digest(blob('deployment/astforum/reminder-worker.mjs'))}


def output_path(output, repo):
    output = Path(output).absolute()
    if any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Output must not contain symlinks')
    output = output.resolve()
    if output == repo or repo in output.parents or output == Path('/'):
        raise ValueError('Output must be outside the source checkout')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError('Output must be a new or empty directory')
    return output


def validate_receipt(receipt, source):
    if receipt['source'] != source or receipt['platform'] != PLATFORM:
        raise ValueError('Source/platform mismatch')
    if not re.fullmatch(r'[0-9a-f]{64}', receipt['metadata_sha256']):
        raise ValueError('Missing metadata checksum')
    if any(not re.fullmatch(r'sha256:[0-9a-f]{64}', receipt[field]) for field in
           ('actual_image_id', 'image_config_id', 'exported_image_digest', 'archive_config_id')):
        raise ValueError('Invalid image identity')
    if receipt['actual_image_id'] not in (receipt['image_config_id'], receipt['exported_image_digest']):
        raise ValueError('Loaded image differs from exported manifest/config')
    if receipt['archive_config_id'] != receipt['image_config_id']:
        raise ValueError('Exported archive differs from verified image')
    if set(receipt['verification']) != set(CHECKS) or any(
            value is not True for value in receipt['verification'].values()):
        raise ValueError('Runtime verification incomplete or failed')


def validate_provenance(metadata, source):
    record = metadata.get('buildx.build.provenance', {})
    if (record.get('buildType') != 'https://mobyproject.org/buildkit@v1' or
            not record.get('buildConfig', {}).get('llbDefinition')):
        raise ValueError('Missing full max BuildKit build record')
    materials = record.get('materials', [])
    if not any(re.search(r'(^|/)node@', material.get('uri', '')) and
               material.get('digest', {}).get('sha256') in NODE_MATERIAL_DIGESTS for material in materials):
        raise ValueError('Build record lacks the pinned Node material')
    infos = record.get('metadata', {}).get('https://mobyproject.org/buildkit@v1#metadata', {}).get(
        'source', {}).get('infos', [])
    if not any(Path(info.get('filename', '')).name == 'Dockerfile.clean' and
               digest(base64.b64decode(info.get('data', ''), validate=True)) == source['dockerfile_sha256']
               for info in infos):
        raise ValueError('Build record recipe differs from Git source')


def archive_identity(archive, manifest_id):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', manifest_id):
        raise ValueError('Invalid exported manifest digest')
    with tarfile.open(archive) as stream:
        manifest = json.load(stream.extractfile('manifest.json'))
        config = stream.extractfile(manifest[0]['Config']).read()
        config_id = 'sha256:' + digest(config)
        raw = stream.extractfile('blobs/sha256/' + manifest_id.split(':')[1]).read()
    if 'sha256:' + digest(raw) != manifest_id or json.loads(raw)['config']['digest'] != config_id:
        raise ValueError('Exported manifest/config bytes mismatch')
    parsed = json.loads(config)
    if parsed['os'] + '/' + parsed['architecture'] != PLATFORM:
        raise ValueError('Exported archive platform mismatch')
    return config_id


def wait_ready(probe, attempts=90):
    for _ in range(attempts):
        try:
            probe()
            return
        except RuntimeError:
            time.sleep(2)
    raise RuntimeError('Readiness deadline exceeded')


def context_member(member):
    return not (Path(member.name).name.startswith('.env') and not member.name.endswith('.example'))


def cleanup_owned(kind, name, log):
    if not name.startswith('cal-clean-'):
        raise ValueError('Refusing cleanup of a resource not owned by this pipeline')
    inventory, removal = {
        'container': (['container', 'ls', '-a', '--format', '{{.Names}}'], ['rm', '-fv']),
        'network': (['network', 'ls', '--format', '{{.Name}}'], ['network', 'rm']),
        'builder': (['buildx', 'ls', '--format', '{{.Name}}'], ['buildx', 'rm']),
        'image': (['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], ['image', 'rm']),
    }[kind]
    def exists():
        names = command(['docker', *inventory], log=log, timeout=30).splitlines()
        return name in {value.strip().rstrip('*') for value in names}
    if not exists():
        return
    try:
        command(['docker', *removal, name], log=log, timeout=120)
    except RuntimeError:
        if exists():
            raise


def build(repo, output, source):
    started = datetime.now(timezone.utc).isoformat()
    owned = 'cal-clean-' + secrets.token_hex(6)
    network, runtime_network, builder = owned + '-build', owned + '-test', owned + '-builder'
    db, web, smtp, image = owned + '-pg', owned + '-web', owned + '-smtp', owned + ':candidate'
    worker, migration = owned + '-worker', owned + '-migrate'
    cleanup = []
    cleanup_errors = []
    log = output / 'pipeline.log'
    def docker(*args, timeout=9000, live=False):
        return command(['docker', *map(str, args)], log=log, timeout=timeout, live=live)
    try:
        versions = {'docker': docker('version', '--format', '{{json .}}'),
                    'buildx': docker('buildx', 'version')}
        with tempfile.TemporaryDirectory(prefix=owned + '-') as temporary:
            temp = Path(temporary)
            context = temp / 'context'
            context.mkdir()
            archive = temp / 'source.tar'
            command(['git', '-C', str(repo), 'archive', '--format=tar', '-o', str(archive),
                     source['revision'], *INPUTS])
            with tarfile.open(archive) as stream:
                members = [m for m in stream.getmembers() if context_member(m)]
                stream.extractall(context, members=members, filter='data')
            password, auth, encryption, cron = (secrets.token_hex(32) for _ in range(4))
            url = f'postgresql://build:{password}@{db}:5432/build_clean'
            env = {'DATABASE_URL': url, 'DATABASE_DIRECT_URL': url, 'DATABASE_HOST': db + ':5432',
                   'NEXTAUTH_SECRET': auth, 'CALENDSO_ENCRYPTION_KEY': encryption,
                   'CRON_SECRET': cron, 'BOOKING_REMINDER_EVENT_TYPE_IDS': '',
                   'NEXTAUTH_URL': 'http://localhost:3000', 'EMAIL_SERVER': f'smtp://{smtp}:1025',
                   'EMAIL_FROM': 'test@example.test', 'CALCOM_TELEMETRY_DISABLED': '1',
                   'NEXT_TELEMETRY_DISABLED': '1', 'BOOKING_REMINDER_TEST_DATABASE_URL': url}
            build_secret, runtime_env = temp / 'build.env', temp / 'runtime.env'
            for path, values in ((build_secret, {k: env[k] for k in
                                  ('DATABASE_URL', 'DATABASE_DIRECT_URL', 'NEXTAUTH_SECRET',
                                   'CALENDSO_ENCRYPTION_KEY')}), (runtime_env, env)):
                path.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
                path.chmod(0o600)
            for name, flags in ((network, ()), (runtime_network, ('--internal',))):
                cleanup.append(('network', name))
                docker('network', 'create', *flags, name)
            cleanup.append(('container', db))
            docker('run', '-d', '--name', db, '--network', network,
                   '-e', 'POSTGRES_USER=build', '-e', 'POSTGRES_DB=build_clean',
                   '-e', f'POSTGRES_PASSWORD={password}', POSTGRES)
            postgres_id = json.loads(docker('image', 'inspect', POSTGRES))[0]['RepoDigests']
            wait_ready(lambda: docker('exec', db, 'pg_isready', '-U', 'build', '-d', 'build_clean', timeout=15))
            cleanup.append(('builder', builder))
            docker('buildx', 'create', '--name', builder, '--driver', 'docker-container',
                   '--driver-opt', f'network={network}')
            metadata_path = output / 'buildkit-metadata.json'
            image_archive = output / 'candidate.docker.tar'
            args = ['buildx', 'build', '--builder', builder, '--platform', PLATFORM, '--pull',
                    '--no-cache', '--provenance=false', '--tag', image,
                    '--output', f'type=docker,dest={image_archive}',
                    '--metadata-file', str(metadata_path), '--secret', f'id=build_env,src={build_secret}',
                    '--file', str(context / 'deployment/astforum/Dockerfile.clean')]
            for key, value in [('VCS_REF', source['revision']), ('SOURCE_TREE', source['tree']),
                               ('LOCK_SHA256', source['lock_sha256']),
                               ('DOCKERFILE_SHA256', source['dockerfile_sha256'])]:
                args += ['--build-arg', f'{key}={value}']
            cleanup.append(('image', image))
            docker(*args, '--progress=plain', context, live=True)
            docker('load', '--input', image_archive)
            inspection = json.loads(docker('image', 'inspect', image))[0]
            image_id = inspection['Id']
            labels = inspection['Config']['Labels']
            expected = {'org.opencontainers.image.source': 'https://github.com/mcvvvnukova-bit/astforum-cal-diy',
                        'org.opencontainers.image.revision': source['revision'],
                        'org.opencontainers.image.licenses': 'MIT', 'ru.astforum.source.tree': source['tree'],
                        'ru.astforum.lock.sha256': source['lock_sha256'],
                        'ru.astforum.dockerfile.sha256': source['dockerfile_sha256']}
            if any(labels.get(k) != v for k, v in expected.items()) or (
                    inspection['Os'] + '/' + inspection['Architecture'] != PLATFORM):
                raise ValueError('Actual image labels/platform mismatch')
            metadata = json.loads(metadata_path.read_text())
            validate_provenance(metadata, source)
            exported_digest = metadata.get('containerimage.digest', '')
            config_id = archive_identity(image_archive, exported_digest)
            if (metadata.get('containerimage.config.digest', config_id) != config_id or
                    image_id not in (config_id, exported_digest)):
                raise ValueError('BuildKit/archive/loaded image identity mismatch')
            config_bytes = json.dumps(inspection['Config']).encode()
            if any(value.encode() in config_bytes for value in (password, auth, encryption, cron)):
                raise ValueError('Persisted build credentials in image configuration')
            verification = {'image': True, 'credentials': True}
            cleanup.append(('container', worker))
            worker_bytes = docker('run', '--rm', '--name', worker, '--network', 'none', '--entrypoint', 'cat', image, '/reminder-worker.mjs')
            if digest(worker_bytes.encode()) != source['worker_sha256']:
                raise ValueError('Image worker differs from Git source')
            verification['worker'] = True
            docker('network', 'disconnect', network, db)
            docker('network', 'connect', runtime_network, db)
            smtp_code = "require('net').createServer(s=>{s.write('220 local ESMTP\\r\\n');s.on('data',b=>s.write(b.toString().startsWith('DATA')?'354 data\\r\\n':'250 OK\\r\\n'))}).listen(1025,'0.0.0.0')"
            cleanup.append(('container', smtp))
            docker('run', '-d', '--name', smtp, '--network', runtime_network,
                   '--entrypoint', 'node', image, '-e', smtp_code)
            cleanup.append(('container', migration))
            run = ['run', '--rm', '--name', migration, '--network', runtime_network, '--env-file', str(runtime_env)]
            docker(*run, '--entrypoint', 'yarn', image, 'prisma', 'migrate', 'deploy')
            cleanup.append(('container', web))
            docker('run', '-d', '--name', web, '--network', runtime_network,
                   '--env-file', runtime_env, image)
            login = "fetch('http://localhost:3000/auth/login',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(r.status!==200||!(await r.text()).includes('Sign'))process.exit(1)})"
            wait_ready(lambda: docker('exec', web, 'node', '-e', login, timeout=15))
            verification['login'] = True
            cron_probe = "for(const token of ['', 'invalid', process.env.CRON_SECRET]){const r=await fetch('http://localhost:3000/api/tasks/cron',{method:'POST',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});if(r.status!==(token===process.env.CRON_SECRET?200:401))throw Error('Cron status '+r.status)}"
            docker('exec', web, 'node', '--input-type=module', '-e', cron_probe)
            verification['cron'] = True
            docker('exec', web, 'yarn', 'vitest', 'run', '--config',
                   'packages/features/bookings/reminders/vitest.config.ts', '--maxWorkers=2',
                   '--reporter=json', '--outputFile=/tmp/reminder-tests.json')
            test_report = json.loads(docker('exec', web, 'cat', '/tmp/reminder-tests.json'))
            if test_report['numFailedTests'] or test_report['numPendingTests'] or not test_report['numTotalTests']:
                raise ValueError('Reminder tests failed or were skipped')
            (output / 'reminder-tests.json').write_text(json.dumps(test_report, indent=2) + '\n')
            verification['reminders'] = True
            receipt = {'source': source, 'base_image': BASE, 'platform': PLATFORM,
                       'actual_image_id': image_id, 'image_config_id': config_id,
                       'exported_image_digest': exported_digest,
                       'archive_config_id': config_id, 'archive_sha256': file_digest(image_archive),
                       'metadata_sha256': file_digest(metadata_path),
                       'provenance': {'format': 'buildx.build.provenance', 'mode': 'max',
                                      'embedded_attestation': False},
                       'postgres_image_digests': postgres_id, 'tool_versions': versions, 'builder': builder,
                       'runtime_packages': docker('exec', web, 'dpkg-query', '-W', 'netcat-openbsd', 'wget'),
                       'started_at': started, 'finished_at': datetime.now(timezone.utc).isoformat(),
                       'verification': verification}
            validate_receipt(receipt, source)
            return receipt
    finally:
        for name in (db, web, smtp):
            try:
                command(['docker', 'logs', name], log=output / f'{name}.log', timeout=30)
            except (RuntimeError, OSError, subprocess.TimeoutExpired):
                pass
        for kind, name in reversed(cleanup):
            try:
                cleanup_owned(kind, name, output / 'cleanup.log')
            except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
                cleanup_errors.append(str(error))
                with (output / 'cleanup.log').open('a') as stream:
                    stream.write(str(error) + '\n')
        if cleanup_errors:
            raise RuntimeError('Owned resource cleanup failed; inspect cleanup.log')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output')
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--revision')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise InterruptedError('Build interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    initialized = False
    try:
        repo = args.repo.resolve()
        output = output_path(args.output, repo)
        source = snapshot(repo, args.revision)
        if args.check:
            print(json.dumps(source, indent=2))
            return
        output.mkdir(parents=True, exist_ok=True)
        initialized = True
        os.environ['BUILDX_METADATA_PROVENANCE'] = 'max'
        receipt = build(repo, output, source)
        receipt['cleanup'] = True
        (output / 'release-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    except Exception as error:
        if initialized:
            (output / 'release-receipt.json').unlink(missing_ok=True)
            (output / 'failure.json').write_text(json.dumps({'error': str(error)}) + '\n')
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
