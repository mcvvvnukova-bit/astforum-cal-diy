import importlib.util
import base64
import hashlib
import io
import json
from fnmatch import fnmatchcase
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import tarfile
import time
import unittest

SCRIPT = Path(__file__).with_name('build-clean.py')

FAKE_DOCKER = r"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import time

path = Path(os.environ['DOCKER_FAULT_STATE'])
state = json.loads(path.read_text()) if path.exists() else {'container': [], 'network': [], 'builder': [], 'image': []}
args = sys.argv[1:]

def save():
    path.write_text(json.dumps(state))

phase = os.environ.get('DOCKER_HOLD_PHASE')
if phase and not state.get('held') and (
        (phase == 'logs' and args[0] == 'logs') or (phase == 'cleanup' and args[0] == 'rm')):
    state['held'] = True
    save()
    Path(os.environ['DOCKER_HOLD_MARKER']).write_text(str(os.getpid()))
    print('cleanup transport ready', flush=True)
    time.sleep(0.5)
    state['hold_finished'] = True
    save()

def fail(message):
    save()
    print(message, file=sys.stderr)
    sys.exit(17)

def create(kind, name):
    matches = os.environ.get('DOCKER_FAULT_CREATE') in (kind, name.rsplit('-', 1)[-1])
    if matches and os.environ.get('DOCKER_FAULT_BEFORE') == '1':
        fail('injected failure before creation')
    state[kind].append(name)
    if matches:
        fail('injected start failure after daemon creation')
    save()

def remove(kind, name):
    state.setdefault('removals', []).append([kind, name])
    save()
    if name not in state[kind]:
        fail('resource absent')
    if os.environ.get('DOCKER_FAULT_REMOVE') in (kind, name.rsplit('-', 1)[-1]):
        fail('injected genuine removal failure')
    state[kind].remove(name)
    save()

if args[0] == 'version' or args[:2] == ['buildx', 'version']:
    print('fault-injection transport')
elif args[:2] == ['network', 'create']:
    create('network', args[-1])
elif args[0] == 'run' and '--name' in args:
    name = args[args.index('--name') + 1]
    create('container', name)
    if '--rm' in args:
        state['container'].remove(name)
        save()
    if args[-1] == '/reminder-worker.mjs':
        print('fixture')
elif args[:2] == ['buildx', 'create']:
    create('builder', args[args.index('--name') + 1])
elif args[:2] == ['buildx', 'build']:
    tag = args[args.index('--tag') + 1]
    if '--provenance=false' not in args or os.environ.get('BUILDX_METADATA_PROVENANCE') != 'max':
        fail('incompatible exporter/provenance contract')
    db = next(name for name in state['container'] if name.endswith('-pg'))
    if '--add-host' not in args or args[args.index('--add-host') + 1] != db + ':172.30.0.2':
        fail('owned database host mapping absent')
    if any(value.startswith('--network') or 'network.host' in value for value in args):
        fail('default RUN network must remain isolated')
    state['tag'] = tag
    values = dict(args[i + 1].split('=', 1) for i, value in enumerate(args) if value == '--build-arg')
    state['labels'] = {
        'org.opencontainers.image.source': 'https://github.com/mcvvvnukova-bit/astforum-cal-diy',
        'org.opencontainers.image.revision': values['VCS_REF'], 'org.opencontainers.image.licenses': 'MIT',
        'ru.astforum.source.tree': values['SOURCE_TREE'], 'ru.astforum.lock.sha256': values['LOCK_SHA256'],
        'ru.astforum.dockerfile.sha256': values['DOCKERFILE_SHA256']}
    config = json.dumps({'os': 'linux', 'architecture': 'amd64', 'config': {'Labels': state['labels']}}).encode()
    state['config_id'] = 'sha256:' + hashlib.sha256(config).hexdigest()
    raw = json.dumps({'config': {'digest': state['config_id']}}).encode()
    manifest_id = 'sha256:' + hashlib.sha256(raw).hexdigest()
    config_path = 'blobs/sha256/' + state['config_id'].split(':')[1]
    archive = Path(args[args.index('--output') + 1].split('dest=', 1)[1])
    with tarfile.open(archive, 'w') as stream:
        for name, data in [('manifest.json', json.dumps([{'Config': config_path}]).encode()),
                           (config_path, config), ('blobs/sha256/' + manifest_id.split(':')[1], raw)]:
            member = tarfile.TarInfo(name); member.size = len(data)
            stream.addfile(member, io.BytesIO(data))
    recipe = Path(args[args.index('--file') + 1]).read_bytes()
    Path(args[args.index('--metadata-file') + 1]).write_text(json.dumps({
        'containerimage.config.digest': state['config_id'], 'containerimage.digest': manifest_id,
        'buildx.build.provenance': {'buildType': 'https://mobyproject.org/buildkit@v1',
            'buildConfig': {'llbDefinition': [{'id': 'step0'}]},
            'materials': [{'uri': 'pkg:docker/node@24.18.1-bookworm', 'digest': {'sha256':
                '87362b5d965240a1bc79f85cec63179d4ee853741413b274a4721f2742eb8393'}}],
            'metadata': {'https://mobyproject.org/buildkit@v1#metadata': {'source': {'infos': [
                {'filename': 'Dockerfile.clean', 'data': base64.b64encode(recipe).decode()}]}}}}}))
    save()
elif args[0] == 'load':
    state['image'].append(state['tag'])
    save()
elif args[0] == 'inspect':
    print(json.dumps([{'Name': '/' + args[-1], 'NetworkSettings': {
        'Networks': {state['network'][0]: {'IPAddress': '172.30.0.2'}}, 'Ports': {'5432/tcp': None}}}]))
elif args[:2] == ['image', 'inspect']:
    if args[-1].startswith('postgres:'):
        print(json.dumps([{'RepoDigests': ['postgres@sha256:' + 'a' * 64]}]))
    else:
        print(json.dumps([{'Id': state['config_id'], 'Os': 'linux', 'Architecture': 'amd64',
                           'Config': {'Labels': state['labels'], 'Env': []}}]))
elif args[0] == 'run' and args[-1] == '/reminder-worker.mjs':
    print('fixture')
elif args[0] == 'rm':
    remove('container', args[-1])
elif args[:2] in (['network', 'rm'], ['buildx', 'rm'], ['image', 'rm']):
    remove({'network': 'network', 'buildx': 'builder', 'image': 'image'}[args[0]], args[-1])
elif args[:2] in (['container', 'ls'], ['network', 'ls'], ['buildx', 'ls'], ['image', 'ls']):
    kind = {'container': 'container', 'network': 'network', 'buildx': 'builder', 'image': 'image'}[args[0]]
    print('\n'.join(state[kind]))
elif args[0] == 'exec' and args[-2:] == ['cat', '/tmp/reminder-tests.json']:
    print(json.dumps({'numFailedTests': 0, 'numPendingTests': 0, 'numTotalTests': 1}))
elif args[0] not in ('exec', 'logs', 'network', 'run'):
    fail('unsupported fault transport command')
"""



class CleanBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        for name in ('package.json', 'yarn.lock', '.yarnrc.yml', '.yarn/fixture', 'turbo.json',
                     'i18n.json', 'apps/fixture', 'packages/fixture', 'example-apps/fixture',
                     'scripts/fixture', 'biome.json', 'biome-staged.json', 'LICENSE',
                     'deployment/astforum/start.sh', 'deployment/astforum/Dockerfile.clean',
                     'deployment/astforum/reminder-worker.mjs', 'deployment/astforum/check-build-database.mjs'):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.out = self.root / 'output'

    def test_build_database_preflight_connects_only_to_expected_address_without_credentials(self):
        script = SCRIPT.with_name('check-build-database.mjs')
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0)); server.listen()
            port = server.getsockname()[1]
            env = {**os.environ, 'DATABASE_URL': f'postgresql://build:probe-private@127.0.0.1:{port}/build_clean',
                   'BUILD_DATABASE_IP': '127.0.0.1'}
            result = subprocess.run(['node', str(script)], env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            server.settimeout(1)
            client, _ = server.accept(); client.close()
            self.assertIn('TCP accepted', result.stdout)
            self.assertNotIn('probe-private', result.stdout + result.stderr)
            env['BUILD_DATABASE_IP'] = '192.0.2.1'
            denied = subprocess.run(['node', str(script)], env=env, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(denied.returncode, 0)
            self.assertNotIn('probe-private', denied.stdout + denied.stderr)
            with self.assertRaises(socket.timeout):
                server.accept()
        env['BUILD_DATABASE_IP'] = '127.0.0.1'
        refused = subprocess.run(['node', str(script)], env=env, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(refused.returncode, 0)

    def test_build_database_address_is_bound_to_exact_owned_network_and_container(self):
        module = importlib.util.module_from_spec(importlib.util.spec_from_file_location('clean_build', SCRIPT))
        module.__spec__.loader.exec_module(module)
        db, network = 'cal-clean-test-pg', 'cal-clean-test-build'
        inspected = {'Name': '/' + db, 'NetworkSettings': {
            'Networks': {network: {'IPAddress': '172.30.0.2'}}, 'Ports': {'5432/tcp': None}}}
        self.assertEqual(module.build_database_ip(inspected, db, network), '172.30.0.2')
        for altered in ({**inspected, 'Name': '/foreign-pg'},
                        {**inspected, 'NetworkSettings': {'Networks': {'foreign': {'IPAddress': '172.30.0.2'}}}},
                        {**inspected, 'NetworkSettings': {'Networks': {network: {'IPAddress': ''}}}},
                        {**inspected, 'NetworkSettings': {'Networks': {network: {'IPAddress': '8.8.8.8'}}}},
                        {**inspected, 'NetworkSettings': {**inspected['NetworkSettings'], 'Ports': {'5432/tcp': [{}]}}}):
            with self.subTest(altered=altered), self.assertRaises(ValueError):
                module.build_database_ip(altered, db, network)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def test_start_runs_git_nonexecutable_helpers_and_stops_before_web_on_init_failure(self):
        context = self.root / 'startup'
        context.mkdir()
        tracked = subprocess.check_output(['git', '-C', str(SCRIPT.parents[2]), 'archive', 'HEAD',
                                           'scripts/replace-placeholder.sh', 'scripts/wait-for-it.sh'])
        with tarfile.open(fileobj=io.BytesIO(tracked)) as archive:
            archive.extractall(context, filter='data')
        for helper in (context / 'scripts').iterdir():
            self.assertFalse(helper.stat().st_mode & 0o111)
        bin_dir = context / 'node_modules/.bin'
        bin_dir.mkdir(parents=True)
        for name, arguments, marker in (
                ('nc', '-w 1 -z owned-db 5432', 'database'),
                ('prisma', 'migrate deploy --schema packages/prisma/schema.prisma', 'migration'),
                ('ts-node', '--transpile-only scripts/seed-app-store.ts', 'seed'),
                ('yarn', 'start', 'web')):
            stub = bin_dir / name
            stub.write_text(f'#!/bin/sh\n[ "$*" = "{arguments}" ] || exit 19\n'
                            f'echo {marker} >> "$START_TRACE"\n'
                            f'[ "${{START_FAILURE:-}}" != "{marker}" ] || exit 23\n')
            stub.chmod(0o755)
        start = SCRIPT.with_name('start.sh').read_text()
        # Keep the real startup commands; only relocate its fixed container working directory.
        self.assertEqual(start.count('cd /calcom\n'), 1)
        start = start.replace('cd /calcom\n', '')
        trace = context / 'trace'
        for failure, expected in (('', ['database', 'migration', 'seed', 'web']),
                                  ('migration', ['database', 'migration']),
                                  ('seed', ['database', 'migration', 'seed'])):
            with self.subTest(failure=failure):
                trace.unlink(missing_ok=True)
                result = subprocess.run(['sh', '-c', start], cwd=context, capture_output=True, text=True,
                                        timeout=5, env={**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'],
                                        'DATABASE_HOST': 'owned-db:5432', 'BUILT_NEXT_PUBLIC_WEBAPP_URL': 'same',
                                        'NEXT_PUBLIC_WEBAPP_URL': 'same', 'START_TRACE': str(trace),
                                        'START_FAILURE': failure})
                self.assertEqual(result.returncode, 23 if failure else 0, result.stderr)
                self.assertEqual(trace.read_text().splitlines(), expected)

    def run_cli(self, *args, env=None):
        return subprocess.run([os.sys.executable, str(SCRIPT), str(self.out),
                               '--repo', str(self.repo), *args], capture_output=True, text=True, env=env)

    def test_clean_snapshot_check_succeeds_without_creating_output(self):
        result = self.run_cli('--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.out.exists())

    def test_command_preserves_progress_before_subprocess_exits(self):
        log, release, console = self.root / 'live.log', self.root / 'release', self.root / 'console.log'
        child = "import pathlib,time; print('progress',flush=True); " + \
                f"p=pathlib.Path({str(release)!r}); " + \
                "exec('while not p.exists(): time.sleep(0.02)'); print('finished',flush=True)"
        caller = f"import runpy; m=runpy.run_path({str(SCRIPT)!r}); " + \
                 f"m['command']([{os.sys.executable!r},'-c',{child!r}],log={str(log)!r},timeout=8,live=True)"
        with console.open('wb') as stream, subprocess.Popen(
                [os.sys.executable, '-c', caller], stdout=stream, stderr=subprocess.PIPE) as process:
            try:
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and not (
                        log.exists() and b'progress' in log.read_bytes() and b'progress' in console.read_bytes()):
                    time.sleep(0.02)
                self.assertIsNone(process.poll())
                self.assertTrue(log.exists() and b'progress' in log.read_bytes(),
                                'Progress must be durable while the subprocess is still running')
                self.assertIn(b'progress', console.read_bytes(), 'CI console progress must also be live')
            finally:
                release.touch()
                stdout, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, stderr)
        self.assertEqual(log.read_bytes(), b'progress\nfinished\n')
        self.assertEqual(console.read_bytes(), b'progress\nfinished\n')

    def test_command_timeout_preserves_partial_output(self):
        spec = importlib.util.spec_from_file_location('clean_build', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        log = self.root / 'timeout.log'
        with self.assertRaisesRegex(RuntimeError, 'exceeded'):
            module.command([os.sys.executable, '-c',
                            "import time; print('partial',flush=True); time.sleep(10)"],
                           log=log, timeout=0.2)
        self.assertEqual(log.read_bytes(), b'partial\n')

    def test_sigterm_during_selector_wait_fails_closed_and_kills_descendants(self):
        self.assert_sigterm_cancels_build(readiness=False)

    def test_sigterm_during_readiness_is_not_retried(self):
        self.assert_sigterm_cancels_build(readiness=True)

    def assert_sigterm_cancels_build(self, readiness):
        release, pids = self.root / 'release', self.root / 'pids.json'
        ready, survived = self.root / 'descendant-ready', self.root / 'survived'
        descendant = (f"from pathlib import Path; import time; Path({str(ready)!r}).touch(); "
                      f"time.sleep(0.8); Path({str(survived)!r}).touch(); time.sleep(10)")
        child = f"""
import json, os, subprocess, time
from pathlib import Path
descendant = subprocess.Popen([{os.sys.executable!r}, '-c', {descendant!r}])
Path({str(pids)!r}).write_text(json.dumps([os.getpid(), descendant.pid]))
while not Path({str(ready)!r}).exists(): time.sleep(0.01)
print('held command ready', flush=True)
while not Path({str(release)!r}).exists(): time.sleep(0.01)
descendant.terminate()
descendant.wait()
"""
        caller = f"""
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('clean_build', {str(SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def held_build(repo, output, source):
    attempts = 0
    def probe():
        nonlocal attempts
        attempts += 1
        if attempts > 1:
            (output / 'retried').touch()
            return
        module.command([{os.sys.executable!r}, '-c', {child!r}],
                       log=output / 'pipeline.log', timeout=10)
    try:
        module.wait_ready(probe, attempts=2) if {readiness!r} else probe()
        return {{'source': source}}
    finally:
        (output / 'cleanup-invoked').touch()
module.build = held_build
sys.argv = [{str(SCRIPT)!r}, {str(self.out)!r}, '--repo', {str(self.repo)!r}]
module.main()
"""
        with subprocess.Popen([os.sys.executable, '-c', caller], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE) as process:
            cancelled = False
            try:
                deadline = time.monotonic() + 3
                log = self.out / 'pipeline.log'
                while time.monotonic() < deadline and not (
                        log.exists() and b'held command ready' in log.read_bytes()):
                    time.sleep(0.01)
                self.assertIsNone(process.poll())
                self.assertTrue(log.exists() and b'held command ready' in log.read_bytes())
                # The child holds both pipe writers open without producing further bytes.
                time.sleep(0.1)
                process.send_signal(signal.SIGTERM)
                try:
                    stdout, stderr = process.communicate(timeout=1.5)
                    cancelled = True
                except subprocess.TimeoutExpired:
                    release.touch()
                    stdout, stderr = process.communicate(timeout=4)
                states = {pid: subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)],
                          capture_output=True, text=True).stdout.strip() for pid in json.loads(pids.read_text())}
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=3)
                if pids.exists():
                    try:
                        os.killpg(json.loads(pids.read_text())[0], signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            self.assertTrue(cancelled, f'SIGTERM did not stop the CLI promptly: rc={process.returncode}, '
                            f'success={(self.out / "release-receipt.json").exists()}')
            self.assertNotEqual(process.returncode, 0, stderr)
            self.assertTrue((self.out / 'cleanup-invoked').exists())
            self.assertFalse((self.out / 'retried').exists())
            self.assertFalse((self.out / 'release-receipt.json').exists())
            self.assertIn('interrupted', json.loads((self.out / 'failure.json').read_text())['error'])
            self.assertEqual(log.read_bytes(), b'held command ready\n')
            self.assertFalse(survived.exists(), 'Descendant continued executing after cancellation')
            for pid, state in states.items():
                self.assertTrue(not state or state.startswith('Z'), f'Owned process {pid} still runs: {state}')

    def test_command_deadline_remains_bounded_after_output_eof(self):
        pid_path, log = self.root / 'eof-pid', self.root / 'eof.log'
        child = (f"import os,time; from pathlib import Path; Path({str(pid_path)!r}).write_text(str(os.getpid())); "
                 "print('before eof',flush=True); os.close(1); os.close(2); time.sleep(10)")
        caller = f"""
import runpy
module = runpy.run_path({str(SCRIPT)!r})
try:
    module['command']([{os.sys.executable!r}, '-c', {child!r}], log={str(log)!r}, timeout=0.3)
except RuntimeError as error:
    print(error)
else:
    raise AssertionError('Expected elapsed deadline after EOF')
"""
        started = time.monotonic()
        with subprocess.Popen([os.sys.executable, '-c', caller], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE) as process:
            try:
                stdout, stderr = process.communicate(timeout=2)
            finally:
                if pid_path.exists():
                    try:
                        os.killpg(int(pid_path.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=3)
        self.assertEqual(process.returncode, 0, stderr)
        self.assertLess(time.monotonic() - started, 2)
        self.assertIn(b'exceeded', stdout)
        self.assertEqual(log.read_bytes(), b'before eof\n')

    def test_dirty_and_invalid_revisions_fail_closed(self):
        for revision in ('not-a-revision', 'HEAD', 'f' * 40):
            self.assertNotEqual(self.run_cli('--check', '--revision', revision).returncode, 0)
        (self.repo / 'yarn.lock').write_text('dirty')
        self.assertNotEqual(self.run_cli('--check').returncode, 0)
        self.assertFalse(self.out.exists())

    def test_committed_private_environment_or_compiled_bytes_are_rejected(self):
        for name in ('.env.production', 'node_modules/package/index.js', 'apps/web/.next/server.js'):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('forbidden')
            self.git('add', '.')
            self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'unsafe')
            self.assertNotEqual(self.run_cli('--check').returncode, 0)
            self.assertFalse(self.out.exists())

    def test_known_tracked_environment_is_excluded_from_context(self):
        spec = importlib.util.spec_from_file_location('clean_build', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertFalse(module.context_member(tarfile.TarInfo('packages/prisma/.env')))
        self.assertFalse(module.context_member(tarfile.TarInfo('packages/lib/test/.env.test')))
        self.assertTrue(module.context_member(tarfile.TarInfo('apps/web/package.json')))
        env_link = self.repo / 'packages/prisma/.env'
        env_link.parent.mkdir(parents=True, exist_ok=True)
        env_link.symlink_to('../../.env')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'symlink')
        self.assertEqual(self.run_cli('--check').returncode, 0)
        env_link.unlink()
        env_link.write_text('private')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'private')
        self.assertNotEqual(self.run_cli('--check').returncode, 0)

    def test_output_inside_repo_nonempty_or_symlink_is_rejected(self):
        self.out.mkdir()
        (self.out / 'keep').write_text('precious')
        self.assertNotEqual(self.run_cli().returncode, 0)
        self.assertEqual((self.out / 'keep').read_text(), 'precious')
        self.assertEqual([p.name for p in self.out.iterdir()], ['keep'])
        for target in (self.repo / 'output', self.root / 'link'):
            if target.name == 'link':
                target.symlink_to(self.out, target_is_directory=True)
            self.out = target
            self.assertNotEqual(self.run_cli('--check').returncode, 0)

    def test_missing_docker_preserves_failure_without_success_receipt(self):
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'git').symlink_to(subprocess.check_output(['which', 'git'], text=True).strip())
        result = self.run_cli(env={**os.environ, 'PATH': str(bin_dir)})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.out / 'release-receipt.json').exists())
        self.assertTrue((self.out / 'failure.json').exists())

    def fault_cli(self, create, before=False, remove='', cancel_phase=''):
        bin_dir = self.root / 'fault-bin'
        bin_dir.mkdir(exist_ok=True)
        docker = bin_dir / 'docker'
        docker.write_text('#!' + os.sys.executable + '\n' + FAKE_DOCKER)
        docker.chmod(0o700)
        state_path = self.root / 'docker-state.json'
        marker = self.root / 'cleanup-held'
        marker.unlink(missing_ok=True)
        env = {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                                  'DOCKER_FAULT_STATE': str(state_path), 'DOCKER_FAULT_CREATE': create,
                                  'DOCKER_FAULT_BEFORE': '1' if before else '0',
                                  'DOCKER_FAULT_REMOVE': remove, 'DOCKER_HOLD_PHASE': cancel_phase,
                                  'DOCKER_HOLD_MARKER': str(marker)}
        if not cancel_phase:
            result = self.run_cli(env=env)
        else:
            args = [os.sys.executable, str(SCRIPT), str(self.out), '--repo', str(self.repo)]
            with subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
                try:
                    deadline = time.monotonic() + 5
                    while not marker.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(marker.exists(), 'Actual build did not reach held finally transport')
                    time.sleep(0.1)
                    process.send_signal(signal.SIGTERM)
                    stdout, stderr = process.communicate(timeout=5)
                    result = subprocess.CompletedProcess(args, process.returncode, stdout.decode(), stderr.decode())
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate(timeout=3)
                    if marker.exists():
                        try:
                            os.killpg(int(marker.read_text()), signal.SIGKILL)
                        except ProcessLookupError:
                            pass
        return result, json.loads(state_path.read_text())

    def test_sigterm_during_actual_finally_preserves_all_owned_removals(self):
        for create in ('', 'pg'):
            for phase in ('logs', 'cleanup'):
                with self.subTest(create=create, phase=phase):
                    self.out = self.root / f'cancel-{create}-{phase}'
                    (self.root / 'docker-state.json').unlink(missing_ok=True)
                    result, state = self.fault_cli(create, cancel_phase=phase)
                    self.assertNotEqual(result.returncode, 0, result.stderr)
                    self.assertTrue(state.get('hold_finished'), 'Cancellation interrupted active owned cleanup')
                    self.assertEqual({key: state[key] for key in ('container', 'network', 'builder', 'image')},
                                     {'container': [], 'network': [], 'builder': [], 'image': []})
                    self.assertEqual(len(state['removals']), 3 if create else 7)
                    self.assertIn('interrupted', (self.out / 'failure.json').read_text())
                    self.assertFalse((self.out / 'release-receipt.json').exists())

    def test_actual_cleanup_normal_success_and_removal_error_controls(self):
        for remove in ('', 'web'):
            with self.subTest(remove=remove):
                self.out = self.root / ('cleanup-control-' + remove)
                (self.root / 'docker-state.json').unlink(missing_ok=True)
                result, state = self.fault_cli('', remove=remove)
                self.assertEqual(len(state['removals']), 7)
                self.assertEqual(result.returncode, 1 if remove else 0, result.stderr)
                self.assertEqual(len(state['container']), 1 if remove else 0)
                self.assertEqual([state[key] for key in ('network', 'builder', 'image')], [[], [], []])
                if remove:
                    self.assertIn('cleanup failed', (self.out / 'failure.json').read_text())
                    self.assertFalse((self.out / 'release-receipt.json').exists())
                else:
                    self.assertTrue(json.loads((self.out / 'release-receipt.json').read_text())['cleanup'])
                    self.assertFalse((self.out / 'failure.json').exists())

    def test_actual_cleanup_cancellation_preserves_removal_failure_evidence(self):
        result, state = self.fault_cli('', remove='web', cancel_phase='cleanup')
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(state.get('removals', [])), 7)
        self.assertEqual(len(state['container']), 1)
        self.assertTrue(state['container'][0].endswith('-web'))
        self.assertEqual([state[key] for key in ('network', 'builder', 'image')], [[], [], []])
        self.assertIn('interrupted', (self.out / 'failure.json').read_text())
        self.assertIn('cleanup failed', (self.out / 'failure.json').read_text())
        self.assertIn('failed', (self.out / 'cleanup.log').read_text())
        self.assertFalse((self.out / 'release-receipt.json').exists())

    def test_partial_creation_failure_cleans_every_registered_owned_resource(self):
        for kind in ('network', 'pg', 'builder', 'worker', 'smtp', 'migrate', 'web'):
            with self.subTest(kind=kind):
                self.out = self.root / ('output-' + kind)
                (self.root / 'docker-state.json').unlink(missing_ok=True)
                result, state = self.fault_cli(kind)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('start failure after daemon creation', (self.out / 'pipeline.log').read_text())
                self.assertFalse((self.out / 'release-receipt.json').exists())
                self.assertTrue((self.out / 'failure.json').exists())
                self.assertEqual({key: state[key] for key in ('container', 'network', 'builder', 'image')},
                                 {'container': [], 'network': [], 'builder': [], 'image': []})
                self.out = self.root / ('output-' + kind)
                (self.root / 'docker-state.json').unlink()

    def test_absent_resource_is_clean_but_real_removal_failure_remains_fail_closed(self):
        result, state = self.fault_cli('pg', before=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('cleanup failed', (self.out / 'failure.json').read_text())
        self.assertEqual(state['network'], [])
        self.out = self.root / 'removal-failure'
        (self.root / 'docker-state.json').unlink()
        result, state = self.fault_cli('web', remove='web')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(state['container']), 1)
        self.assertTrue(state['container'][0].endswith('-web'))
        self.assertIn('cleanup failed', (self.out / 'failure.json').read_text())
        self.assertFalse((self.out / 'release-receipt.json').exists())

    def workflow_push_matches(self, changed_path, branch):
        lines = (SCRIPT.parents[2] / '.github/workflows/astforum-image.yml').read_text().splitlines()
        filters, section = {'branches': [], 'paths': []}, None
        for line in lines:
            if line.startswith('    branches:') or line.startswith('    paths:'):
                section, value = line.strip().split(':', 1)
                if value.strip():
                    filters[section] = [item.strip().strip("\"'") for item in value.strip()[1:-1].split(',')]
            elif line.startswith('      - ') and section:
                filters[section].append(line.strip()[2:].strip("\"'"))
            elif line and not line.startswith('      '):
                section = None
        return (any(fnmatchcase(branch, pattern) for pattern in filters['branches']) and
                any(fnmatchcase(changed_path, pattern) for pattern in filters['paths']))

    def test_push_of_every_consumed_context_root_triggers_candidate(self):
        spec = importlib.util.spec_from_file_location('clean_build', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for root in module.INPUTS:
            changed_path = root + '/nested/changed-source.ts' if (SCRIPT.parents[2] / root).is_dir() else root
            with self.subTest(changed_path=changed_path):
                self.assertTrue(self.workflow_push_matches(changed_path, 'codex/PROJ-153-cal-diy-image-provenance'))

    def test_dependent_candidate_branch_triggers_push_verification(self):
        self.assertTrue(self.workflow_push_matches('yarn.lock', 'codex/PROJ-153-cal-diy-image-verification-fixes'))
        self.assertTrue(self.workflow_push_matches('deployment/astforum/Dockerfile.clean',
                                                  'codex/PROJ-153-cal-diy-build-network'))

    def test_receipt_rejects_identity_mismatch_or_failed_runtime(self):
        spec = importlib.util.spec_from_file_location('clean_build', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = {'revision': self.sha, 'tree': 'a' * 40}
        receipt = {'source': source, 'actual_image_id': 'sha256:' + 'b' * 64,
                   'metadata_sha256': 'e' * 64,
                   'image_config_id': 'sha256:' + 'b' * 64,
                   'exported_image_digest': 'sha256:' + 'd' * 64,
                   'archive_config_id': 'sha256:' + 'b' * 64,
                   'platform': 'linux/amd64',
                   'verification': {key: True for key in module.CHECKS}}
        module.validate_receipt(receipt, source)
        containerd = {**receipt, 'actual_image_id': receipt['exported_image_digest']}
        module.validate_receipt(containerd, source)
        for field, bad in [('source', {'revision': 'c' * 40}),
                           ('archive_config_id', 'sha256:' + 'c' * 64),
                           ('actual_image_id', 'sha256:' + 'c' * 64),
                           ('metadata_sha256', ''),
                           ('verification', {key: False for key in module.CHECKS})]:
            altered = json.loads(json.dumps(receipt))
            altered[field] = bad
            with self.assertRaises(ValueError):
                module.validate_receipt(altered, source)

    def test_max_record_requires_exact_recipe_and_pinned_node_material(self):
        module = importlib.util.module_from_spec(importlib.util.spec_from_file_location('clean_build', SCRIPT))
        module.__spec__.loader.exec_module(module)
        record = {'buildType': 'https://mobyproject.org/buildkit@v1',
                  'buildConfig': {'llbDefinition': [{'id': 'step0'}]},
                  'materials': [{'uri': 'pkg:docker/node@24.18.1-bookworm', 'digest': {'sha256':
                      '87362b5d965240a1bc79f85cec63179d4ee853741413b274a4721f2742eb8393'}}],
                  'metadata': {'https://mobyproject.org/buildkit@v1#metadata': {'source': {'infos': [
                      {'filename': 'Dockerfile.clean', 'data': base64.b64encode(b'fixture\n').decode()}]}}}}
        source = {'dockerfile_sha256': hashlib.sha256(b'fixture\n').hexdigest()}
        module.validate_provenance({'buildx.build.provenance': record}, source)
        for field, value in [('buildConfig', {}), ('materials', []), ('metadata', {})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.validate_provenance({'buildx.build.provenance': {**record, field: value}}, source)
        with self.assertRaises(ValueError):
            module.validate_provenance({'buildx.build.provenance': record}, {'dockerfile_sha256': '0' * 64})
        changed = {**record, 'materials': [{'uri': 'pkg:docker/node@24.18.1-bookworm',
                                          'digest': {'sha256': '0' * 64}}]}
        with self.assertRaises(ValueError):
            module.validate_provenance({'buildx.build.provenance': changed}, source)

    def test_exported_manifest_config_are_verified_from_actual_archive_bytes(self):
        module = importlib.util.module_from_spec(importlib.util.spec_from_file_location('clean_build', SCRIPT))
        module.__spec__.loader.exec_module(module)
        config = b'{"architecture":"amd64","os":"linux"}'
        config_id = 'sha256:' + hashlib.sha256(config).hexdigest()
        manifest = json.dumps({'config': {'digest': config_id}}).encode()
        manifest_id = 'sha256:' + hashlib.sha256(manifest).hexdigest()
        archive = self.root / 'candidate.tar'
        config_path = 'blobs/sha256/' + config_id.split(':')[1]
        with tarfile.open(archive, 'w') as stream:
            for name, data in [('manifest.json', json.dumps([{'Config': config_path}]).encode()),
                               (config_path, config), ('blobs/sha256/' + manifest_id.split(':')[1], manifest)]:
                member = tarfile.TarInfo(name); member.size = len(data)
                stream.addfile(member, io.BytesIO(data))
        self.assertEqual(module.archive_identity(archive, manifest_id), config_id)
        with self.assertRaises((ValueError, KeyError)):
            module.archive_identity(archive, 'sha256:' + '0' * 64)
        original = archive.read_bytes()
        for path in (config_path, 'blobs/sha256/' + manifest_id.split(':')[1]):
            with self.subTest(corrupt=path):
                archive.write_bytes(original)
                with tarfile.open(archive, 'a') as stream:
                    member = tarfile.TarInfo(path); member.size = 2
                    stream.addfile(member, io.BytesIO(b'{}'))
                with self.assertRaises(ValueError):
                    module.archive_identity(archive, manifest_id)


if __name__ == '__main__':
    unittest.main()
