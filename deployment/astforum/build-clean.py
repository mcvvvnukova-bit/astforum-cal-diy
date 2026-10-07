#!/usr/bin/env python3
"""Build a Git-only candidate; write a success receipt only after isolated verification."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import tarfile
import tempfile
import time

BASE = 'node:24.18.1-bookworm@sha256:19cd848a0e073d34bd8cd5545a1b6b4d28489b3e3b607366621ced442bd5f6b4'
POSTGRES = 'postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
PLATFORM = 'linux/amd64'
CHECKS = ('image', 'credentials', 'worker', 'login', 'cron', 'reminders')
INPUTS = ('package.json', 'yarn.lock', '.yarnrc.yml', '.yarn', 'turbo.json', 'i18n.json',
          'apps', 'packages', 'example-apps', 'scripts', 'biome.json', 'biome-staged.json', 'LICENSE', 'deployment/astforum/start.sh',
          'deployment/astforum/reminder-worker.mjs', 'deployment/astforum/Dockerfile.clean')


def command(args, cwd=None, log=None, timeout=9000):
    try:
        result = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                timeout=timeout)
    except subprocess.TimeoutExpired as error:
        if log:
            with Path(log).open('ab') as stream:
                stream.write(error.output or b'')
        raise RuntimeError(f'{args[0:3]} exceeded {timeout}s; inspect logs') from error
    if log:
        with Path(log).open('ab') as stream:
            stream.write(result.stdout)
    if result.returncode:
        raise RuntimeError(f'{args[0:3]} failed ({result.returncode}); inspect preserved logs')
    return result.stdout.decode()


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
           (Path(p).name.startswith('.env') and not Path(p).name.endswith('.example')) for p in tracked):
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
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', receipt['image_id']):
        raise ValueError('Invalid image identity')
    if receipt['archive_config_id'] != receipt['image_id']:
        raise ValueError('Exported archive differs from verified image')
    if set(receipt['verification']) != set(CHECKS) or any(
            value is not True for value in receipt['verification'].values()):
        raise ValueError('Runtime verification incomplete or failed')


def wait_ready(probe, attempts=90):
    for _ in range(attempts):
        try:
            probe()
            return
        except RuntimeError:
            time.sleep(2)
    raise RuntimeError('Readiness deadline exceeded')


def build(repo, output, source):
    started = datetime.now(timezone.utc).isoformat()
    owned = 'cal-clean-' + secrets.token_hex(6)
    network, runtime_network, builder = owned + '-build', owned + '-test', owned + '-builder'
    db, web, smtp, image = owned + '-pg', owned + '-web', owned + '-smtp', owned + ':candidate'
    cleanup = []
    cleanup_errors = []
    log = output / 'pipeline.log'
    def docker(*args, timeout=9000):
        return command(['docker', *map(str, args)], log=log, timeout=timeout)
    versions = {}
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
                # The context has only selected tracked runtime/build inputs, not historical overlays.
                members = [m for m in stream.getmembers() if not m.name.startswith(
                    ('apps/web/.next/', 'deployment/astforum/release-tools/',
                     'deployment/astforum/staging-tools/'))]
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
                docker('network', 'create', *flags, name)
                cleanup.append(('network', 'rm', name))
            docker('run', '-d', '--name', db, '--network', network,
                   '-e', 'POSTGRES_USER=build', '-e', 'POSTGRES_DB=build_clean',
                   '-e', f'POSTGRES_PASSWORD={password}', POSTGRES)
            cleanup.append(('rm', '-fv', db))
            postgres_id = json.loads(docker('image', 'inspect', POSTGRES))[0]['RepoDigests']
            wait_ready(lambda: docker('exec', db, 'pg_isready', '-U', 'build', '-d', 'build_clean', timeout=15))
            docker('buildx', 'create', '--name', builder, '--driver', 'docker-container',
                   '--driver-opt', f'network={network}')
            cleanup.append(('buildx', 'rm', builder))
            metadata_path = output / 'buildkit-metadata.json'
            args = ['buildx', 'build', '--builder', builder, '--platform', PLATFORM, '--pull',
                    '--no-cache', '--provenance=mode=max', '--load', '--tag', image,
                    '--metadata-file', str(metadata_path), '--secret', f'id=build_env,src={build_secret}',
                    '--file', str(context / 'deployment/astforum/Dockerfile.clean')]
            for key, value in [('VCS_REF', source['revision']), ('SOURCE_TREE', source['tree']),
                               ('LOCK_SHA256', source['lock_sha256']),
                               ('DOCKERFILE_SHA256', source['dockerfile_sha256'])]:
                args += ['--build-arg', f'{key}={value}']
            cleanup.append(('image', 'rm', image))
            docker(*args, context)
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
            if metadata.get('containerimage.config.digest') != image_id:
                raise ValueError('BuildKit and loaded image identity mismatch')
            if not re.fullmatch(r'sha256:[0-9a-f]{64}', metadata.get('containerimage.digest', '')):
                raise ValueError('Missing exported image digest')
            config_bytes = json.dumps(inspection['Config']).encode()
            if any(value.encode() in config_bytes for value in (password, auth, encryption, cron)):
                raise ValueError('Persisted build credentials in image configuration')
            verification = {'image': True, 'credentials': True}
            worker = docker('run', '--rm', '--network', 'none', '--entrypoint', 'cat', image, '/reminder-worker.mjs')
            if digest(worker.encode()) != source['worker_sha256']:
                raise ValueError('Image worker differs from Git source')
            verification['worker'] = True
            docker('network', 'disconnect', network, db)
            docker('network', 'connect', runtime_network, db)
            smtp_code = "require('net').createServer(s=>{s.write('220 local ESMTP\\r\\n');s.on('data',b=>s.write(b.toString().startsWith('DATA')?'354 data\\r\\n':'250 OK\\r\\n'))}).listen(1025,'0.0.0.0')"
            docker('run', '-d', '--name', smtp, '--network', runtime_network,
                   '--entrypoint', 'node', image, '-e', smtp_code)
            cleanup.append(('rm', '-fv', smtp))
            run = ['run', '--rm', '--network', runtime_network, '--env-file', str(runtime_env)]
            docker(*run, '--entrypoint', 'yarn', image, 'prisma', 'migrate', 'deploy')
            docker('run', '-d', '--name', web, '--network', runtime_network,
                   '--env-file', runtime_env, image)
            cleanup.append(('rm', '-fv', web))
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
            image_archive = output / 'candidate.docker.tar'
            docker('save', '--output', image_archive, image)
            with tarfile.open(image_archive) as stream:
                manifest = json.load(stream.extractfile('manifest.json'))
                archive_id = 'sha256:' + digest(stream.extractfile(manifest[0]['Config']).read())
            receipt = {'source': source, 'base_image': BASE, 'platform': PLATFORM, 'image_id': image_id,
                       'exported_image_digest': metadata['containerimage.digest'],
                       'archive_config_id': archive_id, 'archive_sha256': file_digest(image_archive),
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
        for args in reversed(cleanup):
            try:
                command(['docker', *args], log=output / 'cleanup.log', timeout=120)
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
