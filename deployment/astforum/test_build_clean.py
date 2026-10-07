import importlib.util
import json
from fnmatch import fnmatchcase
import os
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest

SCRIPT = Path(__file__).with_name('build-clean.py')

FAKE_DOCKER = r"""
import json
import os
from pathlib import Path
import sys

path = Path(os.environ['DOCKER_FAULT_STATE'])
state = json.loads(path.read_text()) if path.exists() else {'container': [], 'network': [], 'builder': [], 'image': []}
args = sys.argv[1:]

def save():
    path.write_text(json.dumps(state))

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
    state['image'].append(tag)
    values = dict(args[i + 1].split('=', 1) for i, value in enumerate(args) if value == '--build-arg')
    state['labels'] = {
        'org.opencontainers.image.source': 'https://github.com/mcvvvnukova-bit/astforum-cal-diy',
        'org.opencontainers.image.revision': values['VCS_REF'], 'org.opencontainers.image.licenses': 'MIT',
        'ru.astforum.source.tree': values['SOURCE_TREE'], 'ru.astforum.lock.sha256': values['LOCK_SHA256'],
        'ru.astforum.dockerfile.sha256': values['DOCKERFILE_SHA256']}
    Path(args[args.index('--metadata-file') + 1]).write_text(json.dumps({
        'containerimage.config.digest': 'sha256:' + 'b' * 64,
        'containerimage.digest': 'sha256:' + 'c' * 64}))
    save()
elif args[:2] == ['image', 'inspect']:
    if args[-1].startswith('postgres:'):
        print(json.dumps([{'RepoDigests': ['postgres@sha256:' + 'a' * 64]}]))
    else:
        print(json.dumps([{'Id': 'sha256:' + 'b' * 64, 'Os': 'linux', 'Architecture': 'amd64',
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
                     'deployment/astforum/reminder-worker.mjs'):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.out = self.root / 'output'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def run_cli(self, *args, env=None):
        return subprocess.run([os.sys.executable, str(SCRIPT), str(self.out),
                               '--repo', str(self.repo), *args], capture_output=True, text=True, env=env)

    def test_clean_snapshot_check_succeeds_without_creating_output(self):
        result = self.run_cli('--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.out.exists())

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

    def fault_cli(self, create, before=False, remove=''):
        bin_dir = self.root / 'fault-bin'
        bin_dir.mkdir(exist_ok=True)
        docker = bin_dir / 'docker'
        docker.write_text('#!' + os.sys.executable + '\n' + FAKE_DOCKER)
        docker.chmod(0o700)
        state_path = self.root / 'docker-state.json'
        result = self.run_cli(env={**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                                  'DOCKER_FAULT_STATE': str(state_path), 'DOCKER_FAULT_CREATE': create,
                                  'DOCKER_FAULT_BEFORE': '1' if before else '0',
                                  'DOCKER_FAULT_REMOVE': remove})
        return result, json.loads(state_path.read_text())

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

    def test_receipt_rejects_identity_mismatch_or_failed_runtime(self):
        spec = importlib.util.spec_from_file_location('clean_build', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = {'revision': self.sha, 'tree': 'a' * 40}
        receipt = {'source': source, 'image_id': 'sha256:' + 'b' * 64,
                   'archive_config_id': 'sha256:' + 'b' * 64,
                   'platform': 'linux/amd64',
                   'verification': {key: True for key in module.CHECKS}}
        module.validate_receipt(receipt, source)
        for field, bad in [('source', {'revision': 'c' * 40}),
                           ('archive_config_id', 'sha256:' + 'c' * 64),
                           ('verification', {key: False for key in module.CHECKS})]:
            altered = json.loads(json.dumps(receipt))
            altered[field] = bad
            with self.assertRaises(ValueError):
                module.validate_receipt(altered, source)


if __name__ == '__main__':
    unittest.main()
