#!/usr/bin/env python3
"""Prepare a complete local video as a silent, validated Codex wallpaper bundle.

Python 3.10+ and the ffmpeg / ffprobe command-line programs are required.
This script never downloads programs or edits the source video.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

GENERATOR = "codex-dynamic-background"
MAX_DURATION = 30.0
MAX_BYTES = 300 * 1024 * 1024
BUNDLE_FILES = ("wallpaper.mp4", "poster.jpg", "preview.html", "metadata.json")


class PreparationError(Exception):
    """An actionable preparation failure."""


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=900)
    except subprocess.TimeoutExpired as exc:
        raise PreparationError(f"{Path(command[0]).name} exceeded the 15-minute operation limit. The source was not modified.") from exc
    if result.returncode:
        detail = result.stderr.strip()[-3000:]
        raise PreparationError(f"{Path(command[0]).name} failed (exit {result.returncode}).\n{detail}")
    return result


def find_program(name: str, explicit: str | None, sibling: Path | None = None) -> Path:
    if explicit:
        candidate = Path(explicit).expanduser()
        if not candidate.is_file():
            raise PreparationError(f"{name} was not found at the explicit path: {candidate}")
        return candidate.resolve()
    located = shutil.which(name)
    if located:
        return Path(located).resolve()
    if sibling:
        candidate = sibling.parent / (name + sibling.suffix)
        if candidate.is_file():
            return candidate.resolve()
    raise PreparationError(
        f"{name} is required. Install FFmpeg (including ffprobe), put its bin directory "
        f"on PATH, or pass --{name} <absolute executable path>. Nothing was downloaded."
    )


def numeric(value: object) -> float | None:
    try:
        number = float(str(value))
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def rate(value: object) -> Fraction | None:
    try:
        result = Fraction(str(value))
        return result if result > 0 else None
    except (ValueError, ZeroDivisionError):
        return None


def inspect_video(ffprobe: Path, video: Path) -> tuple[dict, dict, list[dict]]:
    result = run([str(ffprobe), "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format",
                  "-of", "json", str(video)])
    try:
        data = json.loads(result.stdout)
        streams = data.get("streams", [])
        videos = [stream for stream in streams if stream.get("codec_type") == "video"
                  and not stream.get("disposition", {}).get("attached_pic")]
        if not videos:
            raise PreparationError("The input has no playable video stream (a cover image is not a video).")
        selected = videos[0]
        if int(selected.get("width", 0)) < 2 or int(selected.get("height", 0)) < 2:
            raise PreparationError("The video dimensions are invalid.")
        return data.get("format", {}), selected, streams
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise PreparationError(f"Could not read valid video metadata: {exc}") from exc


def enforce_duration(duration: float) -> None:
    if not math.isfinite(duration) or duration <= 0:
        raise PreparationError("A positive video duration could not be established.")
    # Small tolerance is only for timestamp rounding, not an extra frame allowance.
    if duration > MAX_DURATION + 0.001:
        raise PreparationError(
            f"The video is {duration:.3f} seconds long; the limit is 30 seconds. "
            "Ask the user to choose a segment of at most 30 seconds first. "
            "No automatic trimming or speed changes were performed."
        )


def decoded_timing(ffprobe: Path, video: Path, stream: dict) -> dict:
    """Measure decoded frame timestamps, not just the container's duration claim."""
    result = run([str(ffprobe), "-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", str(stream["index"]),
                  "-show_frames", "-show_entries",
                  "frame=best_effort_timestamp_time,pkt_duration_time,duration_time",
                  "-of", "json", str(video)])
    try:
        frames = json.loads(result.stdout).get("frames", [])
    except (json.JSONDecodeError, AttributeError) as exc:
        raise PreparationError("Could not inspect decoded video frames.") from exc
    if len(frames) < 2:
        raise PreparationError("The input must contain at least two decoded video frames.")
    timestamps = [numeric(frame.get("best_effort_timestamp_time")) for frame in frames]
    if any(stamp is None for stamp in timestamps):
        raise PreparationError("Some decoded video frames have no usable timestamp.")
    if any(after < before for before, after in zip(timestamps, timestamps[1:])):
        raise PreparationError("Video frame timestamps go backwards; repair the source before using it.")
    nominal_rate = rate(stream.get("avg_frame_rate")) or rate(stream.get("r_frame_rate"))
    gaps = sorted(after - before for before, after in zip(timestamps, timestamps[1:]) if after > before)
    last_frame = frames[-1]
    final_duration = numeric(last_frame.get("duration_time")) or numeric(last_frame.get("pkt_duration_time"))
    if not final_duration or final_duration <= 0:
        final_duration = gaps[len(gaps) // 2] if gaps else (1 / float(nominal_rate) if nominal_rate else None)
    if final_duration is None:
        raise PreparationError("The last frame's duration could not be established.")
    duration = timestamps[-1] - timestamps[0] + final_duration
    enforce_duration(duration)
    fps = len(frames) / duration
    return {"duration_seconds": duration, "decoded_frames": len(frames),
            "measured_fps": fps, "nominal_rate": nominal_rate}


def fully_decode(ffmpeg: Path, video: Path, stream_index: int) -> None:
    run([str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-xerror",
         "-protocol_whitelist", "file,pipe", "-i", str(video), "-map", f"0:{stream_index}", "-an", "-sn", "-dn",
         "-f", "null", "-"])


def validate_destination(output: Path, source: Path, force: bool) -> None:
    if output == source or output in source.parents:
        raise PreparationError("The output bundle must not contain the source video. Choose another directory.")
    if not output.exists():
        return
    if not output.is_dir() or output.is_symlink():
        raise PreparationError("The output path must be a regular directory, not a file or symbolic link.")
    if not force:
        raise PreparationError("The output directory already exists. Choose a new path or use --force for a generated bundle.")
    entries = list(output.iterdir())
    if not entries:
        return
    try:
        owned = json.loads((output / "metadata.json").read_text(encoding="utf-8")).get("generator") == GENERATOR
    except (OSError, ValueError, AttributeError):
        owned = False
    if not owned:
        raise PreparationError("--force only replaces a bundle created by this script, or an empty directory.")
    for name in BUNDLE_FILES:
        existing = output / name
        if existing.is_symlink() or (existing.exists() and not existing.is_file()):
            raise PreparationError(f"Refusing to replace an unexpected bundle entry: {name}")


def publish_bundle(stage: Path, output: Path) -> None:
    """Replace only the four generated files, rolling back any interrupted commit."""
    made_directory = not output.exists()
    output.mkdir(parents=True, exist_ok=True)
    installed: list[str] = []
    backed_up: list[str] = []
    try:
        for name in BUNDLE_FILES:
            previous = output / name
            if previous.exists():
                previous.replace(stage / (name + ".previous"))
                backed_up.append(name)
            (stage / name).replace(previous)
            installed.append(name)
    except OSError:
        for name in reversed(installed):
            (output / name).unlink(missing_ok=True)
        for name in reversed(backed_up):
            (stage / (name + ".previous")).replace(output / name)
        if made_directory:
            output.rmdir()
        raise


def prepare(args: argparse.Namespace) -> dict:
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        raise PreparationError(f"Input is not a local file: {source}")
    output = Path(args.output).expanduser().absolute()
    # Check the final directory before resolve() so symlinks cannot conceal it.
    if output.is_symlink():
        raise PreparationError("The output bundle directory cannot be a symbolic link.")
    output = output.resolve()
    validate_destination(output, source, args.force)
    ffmpeg = find_program("ffmpeg", args.ffmpeg)
    ffprobe = find_program("ffprobe", args.ffprobe, ffmpeg)
    _, source_stream, _ = inspect_video(ffprobe, source)
    declared_duration = numeric(source_stream.get("duration"))
    if declared_duration is not None:
        enforce_duration(declared_duration)
    print("Inspecting all input frames...", file=sys.stderr)
    source_timing = decoded_timing(ffprobe, source, source_stream)
    fully_decode(ffmpeg, source, int(source_stream["index"]))
    nominal_rate = source_timing["nominal_rate"]
    source_fps = float(nominal_rate) if nominal_rate else source_timing["measured_fps"]
    limit_fps = args.fps or 60
    scaling = "decrease" if args.fit == "contain" else "increase"
    # FFmpeg already rebases input timestamps during a normal transcode. A
    # setpts filter here can erase frame-duration hints and shorten the last
    # frame in VFR MP4 output, so preserve those hints through the filter graph.
    filters = ["scale=iw*sar:ih", "setsar=1",
               f"scale=1920:1080:force_original_aspect_ratio={scaling}:force_divisible_by=2"]
    if args.fit == "contain":
        filters.append("pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black")
    else:
        filters.append("crop=1920:1080:(iw-ow)/2:(ih-oh)/2")
    filters.append("setsar=1")
    # Preserve source cadence at or below the chosen ceiling. No optical-flow
    # interpolation, speed adjustment, or per-frame replacement is performed.
    if source_fps > limit_fps + 0.001:
        filters.append(f"fps={limit_fps}")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".codex-wallpaper-", dir=output.parent)).resolve()
    published = False
    try:
        video = stage / "wallpaper.mp4"
        print("Encoding the complete video (audio removed)...", file=sys.stderr)
        run([str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-y",
             "-protocol_whitelist", "file,pipe", "-i", str(source), "-map", f"0:{source_stream['index']}", "-an", "-sn", "-dn",
             "-vf", ",".join(filters), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
             "-maxrate", "20M", "-bufsize", "40M", "-pix_fmt", "yuv420p", "-fps_mode", "vfr",
             "-movflags", "+faststart", "-map_metadata", "-1", "-map_chapters", "-1", str(video)])
        if video.stat().st_size > MAX_BYTES:
            raise PreparationError("The encoded video exceeds the 300 MiB runtime limit. No bundle was installed.")
        _, stream, streams = inspect_video(ffprobe, video)
        if stream.get("codec_name") != "h264" or stream.get("pix_fmt") != "yuv420p":
            raise PreparationError("The encoded output does not meet the H.264 / yuv420p requirements.")
        if any(item.get("codec_type") == "audio" for item in streams):
            raise PreparationError("Output validation found an unexpected audio stream.")
        print("Verifying every output frame...", file=sys.stderr)
        result_timing = decoded_timing(ffprobe, video, stream)
        fully_decode(ffmpeg, video, int(stream["index"]))
        result_rate = rate(stream.get("avg_frame_rate")) or rate(stream.get("r_frame_rate"))
        result_fps = float(result_rate) if result_rate else result_timing["measured_fps"]
        if result_fps > limit_fps + 0.1:
            raise PreparationError("Output frame rate exceeds the chosen frame-rate ceiling.")
        # Encoding can quantize the final frame when frame-rate reduction is
        # requested. A larger change means content was lost and must be rejected.
        duration_tolerance = max(0.002, 1 / min(source_fps, limit_fps) + 0.002)
        if abs(result_timing["duration_seconds"] - source_timing["duration_seconds"]) > duration_tolerance:
            raise PreparationError("Output duration differs from the source by more than one frame.")
        run([str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", str(video),
             "-frames:v", "1", "-q:v", "2", "-update", "1", str(stage / "poster.jpg")])
        preview = Path(__file__).resolve().parent.parent / "assets" / "preview.html"
        if not preview.is_file():
            raise PreparationError("The skill's assets/preview.html template is missing. Reinstall the complete skill.")
        shutil.copyfile(preview, stage / "preview.html")
        metadata = {
            "schema_version": 1, "generator": GENERATOR,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "video": "wallpaper.mp4", "poster": "poster.jpg", "fit": args.fit,
            "width": int(stream["width"]), "height": int(stream["height"]),
            "duration_seconds": round(result_timing["duration_seconds"], 6),
            "fps": round(result_fps, 6), "decoded_frames": result_timing["decoded_frames"],
            "video_codec": "h264", "pixel_format": "yuv420p", "audio": False,
            "size_bytes": video.stat().st_size,
            "sha256": sha256_file(video),
            "validation": {"full_decode": "passed", "complete_source_duration": "passed"},
            "source": {"duration_seconds": round(source_timing["duration_seconds"], 6),
                       "width": int(source_stream["width"]), "height": int(source_stream["height"]),
                       "fps": round(source_fps, 6), "decoded_frames": source_timing["decoded_frames"]},
        }
        (stage / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        publish_bundle(stage, output)
        published = True
        return metadata
    finally:
        # Only remove exact files created in the verified private staging path;
        # never recursively delete the user's output or another directory.
        recovery_needed = not published and any((stage / (name + ".previous")).exists() for name in BUNDLE_FILES)
        if recovery_needed:
            print(f"An output commit failed. Previous bundle files were preserved for recovery at: {stage}", file=sys.stderr)
        elif stage.parent == output.parent and stage.name.startswith(".codex-wallpaper-"):
            for name in BUNDLE_FILES:
                (stage / name).unlink(missing_ok=True)
                (stage / (name + ".previous")).unlink(missing_ok=True)
            stage.rmdir()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Local input video of at most 30 seconds")
    parser.add_argument("--output", required=True, help="Destination bundle directory")
    parser.add_argument("--ffmpeg", help="Explicit path to ffmpeg")
    parser.add_argument("--ffprobe", help="Explicit path to ffprobe")
    parser.add_argument("--fit", choices=("contain", "cover"), default="contain",
                        help="contain preserves the entire frame; cover explicitly crops to fill (default: contain)")
    parser.add_argument("--fps", type=int, choices=(30, 60), help="Frame-rate ceiling; never interpolates (default: 60)")
    parser.add_argument("--force", action="store_true", help="Replace an existing generated bundle")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        metadata = prepare(args)
        print(json.dumps({"status": "ready", "bundle": str(Path(args.output).resolve()),
                          "duration_seconds": metadata["duration_seconds"], "fps": metadata["fps"]}, ensure_ascii=False))
        return 0
    except (PreparationError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
