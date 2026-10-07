import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('build-clean.py')


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
