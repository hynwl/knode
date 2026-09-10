#!/usr/bin/env python3
"""M6-T2 스파이크 — 백엔드를 임베디드 Python 위에 패키징한다.

`uv`(https://docs.astral.sh/uv/)로 python-build-standalone 인터프리터를 내려받고,
`backend/requirements.txt`를 그 인터프리터 site-packages가 아니라 별도
`site-packages/` 디렉터리에 `--target` 설치한다. 실행 시 `PYTHONPATH`로
그 디렉터리를 가리키면, 인터프리터 본체와 의존성이 완전히 분리된 채로도
동작한다 — venv(`pyvenv.cfg`에 빌드 시점 절대경로가 박혀 재배치 시 깨짐)
대신 이 방식을 쓴 이유. Electron 사이드카(M6-T4b)는 이 산출물을
`extraResources`로 그대로 묶고(M6-T8a), 기동 시 PYTHONPATH를 그때그때
계산해서 넘기면 되므로 설치 위치를 미리 알 필요가 없다.

사용법:
    python3 backend/scripts/package_standalone.py [--output DIR] [--python-version X.Y]
    python3 backend/scripts/package_standalone.py --skip-download   # 인터프리터 재사용, 빠른 반복용
    python3 backend/scripts/package_standalone.py --measure-cold-start

요구사항: `uv` (brew install uv, 또는 https://docs.astral.sh/uv/getting-started/installation/)
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = BACKEND_DIR / "dist_standalone"
DEFAULT_PYTHON_VERSION = "3.12"
HEALTH_PATH = "/api/v1/health"


def run(cmd: list[str], **kwargs) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)


def check_uv() -> None:
    if shutil.which("uv") is None:
        sys.exit(
            "uv가 필요합니다. `brew install uv` 또는 "
            "https://docs.astral.sh/uv/getting-started/installation/ 참고."
        )


def find_python_bin(python_dir: Path) -> Path:
    # uv가 관리하는 python-build-standalone 배포판의 실행파일 위치는 플랫폼/버전에
    # 따라 레이아웃이 갈린다(실측 없이 하나만 가정하면 Windows에서 조용히 깨진다) —
    # macOS/Linux: cpython-*/bin/python3.<N> (uv 관리형) 또는
    #              cpython-*/install/bin/python3.<N> (raw python-build-standalone)
    # Windows:     cpython-*/python.exe (uv 관리형) 또는
    #              cpython-*/install/python.exe (raw python-build-standalone)
    # 후보를 전부 모아서 존재하는 걸 쓴다.
    patterns = [
        "cpython-*/bin/python3.*",
        "cpython-*/install/bin/python3.*",
        "cpython-*/python.exe",
        "cpython-*/install/python.exe",
    ]
    matches: list[Path] = []
    for pattern in patterns:
        matches.extend(python_dir.glob(pattern))
    matches = [m for m in matches if not m.name.endswith("-config")]
    if not matches:
        sys.exit(f"임베디드 인터프리터를 {python_dir} 에서 찾지 못했습니다.")
    return sorted(matches)[0]


def install_python(python_dir: Path, version: str, skip_download: bool) -> Path:
    existing = list(python_dir.glob("cpython-*/bin/python3.*")) if python_dir.exists() else []
    if skip_download and existing:
        print(f"[skip-download] 기존 인터프리터 재사용: {python_dir}")
        return find_python_bin(python_dir)

    if python_dir.exists():
        shutil.rmtree(python_dir)
    python_dir.mkdir(parents=True)
    run(["uv", "python", "install", version, "--install-dir", str(python_dir)])
    return find_python_bin(python_dir)


def install_dependencies(python_bin: Path, site_packages: Path, requirements: Path) -> None:
    if site_packages.exists():
        shutil.rmtree(site_packages)
    site_packages.mkdir(parents=True)
    run(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(python_bin),
            "--target",
            str(site_packages),
            "-r",
            str(requirements),
        ]
    )


def copy_app(output: Path) -> Path:
    app_dst = output / "app"
    if app_dst.exists():
        shutil.rmtree(app_dst)
    shutil.copytree(
        BACKEND_DIR / "app",
        app_dst,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    return app_dst


def dir_size_human(path: Path) -> str:
    # `du`는 Windows CI 러너에 없다 — 순수 파이썬으로 재귀 합산해 이식성을 확보한다.
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    size = float(total)
    for unit in ("B", "K", "M", "G", "T"):
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}P"


def measure_cold_start(python_bin: Path, site_packages: Path, app_dir: Path, port: int, timeout: float) -> float | None:
    env = {
        "PYTHONPATH": str(site_packages),
        "PATH": "/usr/bin:/bin",  # 시스템 PATH 최소 의존성 확인 — PYTHONHOME 등은 세팅하지 않는다
    }
    proc = subprocess.Popen(
        [
            str(python_bin),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=str(app_dir.parent),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    start = time.monotonic()
    url = f"http://127.0.0.1:{port}{HEALTH_PATH}"
    elapsed = None
    try:
        while time.monotonic() - start < timeout:
            if proc.poll() is not None:
                out = proc.stdout.read() if proc.stdout else ""
                sys.exit(f"사이드카가 조기 종료됨 (exit={proc.returncode}):\n{out}")
            try:
                with urllib.request.urlopen(url, timeout=0.5) as resp:
                    if resp.status == 200:
                        elapsed = time.monotonic() - start
                        break
            except Exception:
                time.sleep(0.05)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return elapsed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--python-version", default=DEFAULT_PYTHON_VERSION)
    parser.add_argument("--requirements", type=Path, default=BACKEND_DIR / "requirements.txt")
    parser.add_argument("--skip-download", action="store_true", help="인터프리터 재다운로드 생략(반복 실행용)")
    parser.add_argument("--skip-install", action="store_true", help="의존성 재설치 생략(반복 실행용)")
    parser.add_argument("--measure-cold-start", action="store_true", help="빌드 후 헬스체크까지 소요시간 측정")
    parser.add_argument("--port", type=int, default=8099)
    parser.add_argument("--health-timeout", type=float, default=60.0)
    args = parser.parse_args()

    check_uv()

    output = args.output.resolve()
    python_dir = output / "python"
    site_packages = output / "site-packages"

    output.mkdir(parents=True, exist_ok=True)

    t0 = time.monotonic()
    python_bin = install_python(python_dir, args.python_version, args.skip_download)
    t_python = time.monotonic() - t0

    t1 = time.monotonic()
    if not args.skip_install:
        install_dependencies(python_bin, site_packages, args.requirements)
    else:
        print("[skip-install] 기존 site-packages 재사용")
    t_deps = time.monotonic() - t1

    app_dir = copy_app(output)

    total_size = dir_size_human(output)
    python_size = dir_size_human(python_dir)
    deps_size = dir_size_human(site_packages)

    print("\n=== 패키징 결과 ===")
    print(f"출력 위치        : {output}")
    print(f"인터프리터 설치   : {t_python:.1f}s")
    print(f"의존성 설치       : {t_deps:.1f}s")
    print(f"전체 용량         : {total_size}  (인터프리터 {python_size} + 의존성 {deps_size})")

    if args.measure_cold_start:
        print("\n콜드스타트 측정 중...")
        elapsed = measure_cold_start(python_bin, site_packages, app_dir, args.port, args.health_timeout)
        if elapsed is None:
            print(f"콜드스타트: {args.health_timeout:.0f}s 안에 응답 없음 (실패)")
        else:
            print(f"콜드스타트(spawn → /health 200): {elapsed:.2f}s")


if __name__ == "__main__":
    main()
