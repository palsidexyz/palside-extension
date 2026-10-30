# Signal sound builder

`build.py` mixes the bundled CC0 recordings into 36 AAC-LC sounds (48 kHz,
stereo, 128 kbps target). Recipes live in the script; it imports no extension
UI code. The builder reports sample peak in dBFS and checks decoded sample
peaks below -0.5 dBFS. Its linear interpolation does not measure inter-sample
true peaks. Source provenance and pack licenses are in
[`../../licenses/signal-sounds/`](../../licenses/signal-sounds/).

The encoder is **macOS only: Apple `afconvert`, found on PATH**. Startup fails
with a clear message on other operating systems or if the encoder is missing.
The verified environment is macOS 26.0.1 (25A362), Apple Silicon, CPython 3.9.6,
Pedalboard 0.9.17 and NumPy 2.0.2. `requirements.txt` pins the complete runtime
dependency closure with downloaded wheel SHA-256 hashes, targeting CPython 3.9
on macOS 14+ arm64. No additional Python packages are required.

From the repository root:

```sh
sound_env=$(mktemp -d "${TMPDIR:?}/palside-sound-env.XXXXXX")
python3 -m venv "$sound_env/venv"
"$sound_env/venv/bin/python" -m pip install --require-hashes -r tooling/signal-sounds/requirements.txt
"$sound_env/venv/bin/python" tooling/signal-sounds/build.py
```

To render candidates for review without writing bundled files:

```sh
"$sound_env/venv/bin/python" tooling/signal-sounds/build.py --output-dir "$sound_env/sounds"
```

WAV masters and staging files are created in a temporary directory and removed
when the command exits. An explicit review directory receives the candidate
`.m4a` files and a candidate `manifest.json`; the command exits with status 1 and
lists any outputs that differ from the bundled hashes. Before rendering, the builder verifies the
source recording hashes. `afconvert` inserts the current time into MP4 headers;
the builder replaces the creation/modification fields in `mvhd`, `tkhd` and
`mdhd` with each output's pinned `mp4Timestamp` (seconds since 1904-01-01).
It leaves the encoded audio untouched. Apple AAC encoding can produce different
bytes from identical WAV inputs, so byte-identical regeneration is not guaranteed
even on the documented Mac. The bundled files are the release inputs.

`manifest.json` contains only the output filename, byte length, SHA-256 and MP4
timestamp used by the build. Without `--output-dir`, the builder checks these
values before copying any output into the bundle and fails if the encoder or
audio environment produces different bytes. Changes to recipes require review
of the candidate files and manifest; running the tool does not rewrite the
committed manifest.

The hash lock was generated with:

```sh
python3 -m pip download --no-cache-dir --only-binary=:all: \
  pedalboard==0.9.17 numpy==2.0.2 -d "$sound_env/wheels"
python3 -m pip hash "$sound_env"/wheels/*.whl
```

Use the resulting wheel hashes for the exact package versions in
`requirements.txt`. The wheel metadata lists NumPy as Pedalboard's only runtime
dependency; NumPy has none.
