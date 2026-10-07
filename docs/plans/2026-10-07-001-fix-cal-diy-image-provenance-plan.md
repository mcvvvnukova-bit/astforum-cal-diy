# Cal.diy Image Provenance Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task. The user's approval of the preceding remediation design authorizes execution in this session.

**Goal:** Build and verify a complete Cal.diy image from a named Git commit without inheriting an opaque Forum custom image, and preserve independently checkable source, recipe, image and runtime evidence.

**Architecture:** A dedicated Forum Dockerfile installs the immutable Yarn dependencies and builds the complete web application from source on a pinned official Node image. A single build/verification entry point provisions disposable PostgreSQL and a private builder, records OCI provenance and a release receipt, and checks the candidate against an isolated database. GitHub CI invokes the same entry point and retains the result. Existing production state and historical recipes remain evidence, never build dependencies.

**Tech Stack:** Node.js 24.18.1, Yarn 4.12.0, Docker Buildx, PostgreSQL 16, existing Next.js/Prisma/Vitest and Python standard library.

## Global Constraints

- OpenProject task: OP#PROJ-153; parent OP#PROJ-142; related audit OP#PROJ-152. The branch is `codex/PROJ-153-cal-diy-image-provenance` in `mcvvvnukova-bit/astforum-cal-diy`.
- Base branch is `codex/PROJ-32-sync-cal-diy`, commit `ec4b6d925734130c3d059a14c0f761926e70f8cc`. Preserve the existing draft/review scope and all unrelated worktrees.
- Node image: `node:24.18.1-bookworm@sha256:19cd848a0e073d34bd8cd5545a1b6b4d28489b3e3b607366621ced442bd5f6b4`; candidate platform `linux/amd64`.
- Never inherit `astforum/cal-diy:*`, copied `node_modules`, `.next`, untracked overlays, or a previous custom image. Use the Git snapshot and `yarn install --immutable`.
- Use only disposable build/test database credentials. Never read production `.env`, contact production databases, submit live bookings, or send email externally. Build-time credentials use BuildKit secret mounts and cannot be persisted in image configuration or release receipts.
- The image includes the tracked worker at `/reminder-worker.mjs`; preserve the existing worker mount's compatibility. Web and reminder code come from the same source revision.
- Source revision labels alone are insufficient. Record full Git SHA/tree, lockfile and Dockerfile SHA256, base image digest, target platform, actual exported image identity/digest, build times and real verification outcomes. Failed builds never receive a successful receipt.
- Runtime checks use a disposable database and local SMTP receiver. Existing application UI, booking/reminder policy and database schema do not change.
- Existing source is not byte-for-byte reproducible by assertion: dependency/base pinning plus an observed clean build establish a repeatable recipe. Do not claim identical independent image digests without a second matching build.
- Keep each PR below 500 changed code lines and 10 code files. Split dependent PRs if that limit is reached rather than remove necessary checks.
- GitNexus index at `4bd67735895f539ad99c8037cf7a808306fb9139` matches the functional source; query/impact currently fail because its database is unavailable. Record source-based impact assessment and retry detect_changes after changes; do not disturb another index process.
- Technical plans belong in `docs/plans/`; product documentation belongs in Outline.
- Current SSH endpoint `forum-prod` is the sole authorized server connection and times out before authentication. Fresh VPS parity/deployment stays an explicit external gate until that endpoint works. A built candidate does not reconcile the current opaque VPS image.

## Approved design and alternatives

The user accepted remediation after the explanation of the missing whole-image build chain. The selected approach creates a complete clean candidate with a recorded source-to-image chain, then verifies it independently before replacing anything on VPS. Reconstructing the old overlay chain alone cannot prove its first custom ancestor; archiving the running image supports recovery but does not establish a source build. No changes to product behavior are part of this task.

## Task 1: Add a complete clean build and verification pipeline

**Files:**
- Create: `deployment/astforum/Dockerfile.clean`
- Create: `deployment/astforum/build-clean.py`
- Create: `deployment/astforum/test_build_clean.py`
- Create: `.github/workflows/astforum-image.yml`
- Modify: `deployment/astforum/README.md`

**Interfaces:**
- Consumes: the clean current Git revision, tracked Yarn lockfile, tracked application sources, and disposable Docker resources.
- Produces: CLI `python3 deployment/astforum/build-clean.py OUTPUT_DIRECTORY`, an OCI archive and/or locally loaded candidate, BuildKit metadata/provenance, and `release-receipt.json`. Tests may use a `--check` mode that validates inputs without building. Separate additional helper files are allowed within the PR limits if responsibility requires them.

- [ ] Write focused tests before the implementation for rejection of a dirty snapshot or invalid revision, unsafe/nonempty output directories, and failure paths that cannot produce a success receipt. Receipt checks must reject mismatched source/image identities and a failed runtime result.
- [ ] Run `python3 -m unittest discover -s deployment/astforum -p 'test_build_clean.py' -v` and retain the expected initial failure.
- [ ] Implement the smallest complete pipeline: a pinned official Node image, Git-only context, immutable install, generated Prisma/app-store/embedding artifacts, full Next.js build with type checking enabled, disposable PostgreSQL schema, and an image containing the complete runtime and worker. Use private uniquely named Docker resources and guaranteed cleanup, bounded readiness waits and preserved failure logs.
- [ ] Add verification of actual image labels/platform, absence of persisted build credentials, image worker bytes, login page, authenticated and unauthorized Tasker cron responses, and the existing reminder test suite including its real PostgreSQL test with a local SMTP receiver. Expose no test database ports publicly and do not use production environment.
- [ ] Run the focused tests, syntax/Biome checks and required type checks. Existing Cal.diy instructions require `yarn type-check:ci --force` before push; report actual failures separately and do not declare them unrelated without that command.
- [ ] Add a GitHub Actions workflow scoped to this fork and these build inputs. Invoke the same pipeline for the exact pushed SHA; retain logs, receipt and image/provenance artifacts. CI must not require DockerHub credentials or publish upstream images. It must not send messages to Slack or other people.
- [ ] Document the supported invocation and exact source/image verification boundaries. Commit with `feat(build): PROJ-153 ...`, preserving the small PR scope.

**Test expectations:** Real source validation and failure behavior, not tests that only search the implementation text. The full build/runtime evidence is exercised in Task 2; Task 1 review must distinguish implemented checks from already observed outcomes.

## Task 2: Exercise and reconcile the complete candidate

**Files:** Task 1 pipeline if a real failure requires correction; technical evidence under `artifacts/releases/` or CI artifacts; no production data or secrets.

**Interfaces:** Consumes Task 1's committed pipeline; produces an observed complete build and runtime receipt for its actual Git SHA, plus independent task review.

- [ ] Run the full clean `linux/amd64` pipeline in local Docker or a GitHub runner; prefer native Linux CI for the large application build. Keep progress and logs available during the long build.
- [ ] Resolve each build/runtime failure in the pipeline or scoped compatibility code with covering tests and review. Do not reuse the old custom image to bypass a failure, disable Next.js type checks, or treat a partially built image as completion.
- [ ] Inspect the receipt and actual image/OCI manifest independently: Git SHA/tree, lockfile, recipe and base digest agree; exported bytes/identity agree; worker is built from the same revision; build-only credentials are absent from runtime configuration.
- [ ] Confirm real isolated runtime behavior and PostgreSQL/reminder/SMTP tests; state exactly what was tested. No live booking or external email is authorized by this task.
- [ ] Preserve the evidence and rollback boundary. If SSH becomes available, inspect the old image and active override first and compare the verified candidate on an isolated server instance; do not replace production solely to obtain provenance. If SSH remains unavailable, preserve this external gate and leave the task open.

## Task 3: Publish reviewable work and verify project linkage

**Files:** PR description and technical evidence only, unless a verification failure requires a reviewed fix.

- [ ] Push all scoped commits to `mcvvvnukova-bit/astforum-cal-diy`, create a draft PR targeting `codex/PROJ-32-sync-cal-diy`, and explicitly name `OP#PROJ-153` and `OP#PROJ-142` in its body. Attach the PR to this chat.
- [ ] Verify exact GitHub head, actual checks and retained build artifacts, and saved/reopened PR linkage in OpenProject under user 8 `kuzmina`.
- [ ] Perform whole-branch review, address findings, record completed and outstanding gates, and report source/build/runtime proof with PR and task links. Do not mark the VPS gap or the whole task complete while its required live reconciliation remains unavailable.

## Sources

- Existing whole-image boundary: Forum `artifacts/releases/2026-10-07-vps-shared-observed.json` and `artifacts/repository-audits/2026-10-07-runtime-reconciliation.json`.
- Historical overlay chain: `deployment/astforum/release-tools/e62aef037860a2ff393a6a131a226bd7c00b4114/Dockerfile.release` and `deployment/astforum/staging-tools/cal-reminders-build.DIBF4g/prepare-runtime-fix.py`.
- Build provenance: https://docs.docker.com/build/metadata/attestations/slsa-provenance/
- Build secret mounts: https://docs.docker.com/build/building/secrets/
- Immutable dependencies: https://yarnpkg.com/cli/install
