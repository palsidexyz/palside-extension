"""Render bundled signal sounds from CC0 recordings. See README.md for the macOS encoder and setup."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess
import struct
import shutil
import sys
import tempfile

if sys.platform != "darwin":
    raise SystemExit("Signal sound encoding requires macOS and Apple afconvert.")
ENCODER = shutil.which("afconvert")
if not ENCODER:
    raise SystemExit("Signal sound encoding requires Apple afconvert on PATH.")

import numpy as np
from pedalboard import Pedalboard, HighpassFilter, LowpassFilter, HighShelfFilter, Compressor, Reverb, Delay, Distortion, Limiter
from pedalboard.io import AudioFile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'apps/extension/public/signals/sounds'
SOURCES = HERE / 'sources'
RATE = 48000
LUFS = -18.0
PEAK_DB = -1.5

LOG, CLAVES, TRUMPET = 'vsco/LogDrumHi_MedM_v2_rr1_Sum.wav', 'vsco/Claves1_Hit_v2_rr1_Sum.wav', 'vsco/Sum_SHTrumpet_stac_D4_v3_rr1.wav'
K = lambda name: f'kenney/{name}.ogg'
FS = lambda sound_id: f'freesound/fs-{sound_id}.mp3'


def hz(note):
    name, octave = re.fullmatch(r'([A-G](?:s|b)?)(\d)', note).groups()
    semitone = dict(C=0, Cs=1, Db=1, D=2, Ds=3, Eb=3, E=4, F=5, Fs=6, Gb=6, G=7, Gs=8, Ab=8, A=9, As=10, Bb=10, B=11)[name]
    return 440 * 2 ** ((semitone - 9) / 12 + int(octave) - 4)


def L(file, at, db, *, note=None, speed=1.0, skip=0.0, length=.4, fadein=0.0, pan=0.0, reverse=False,
      hp=None, lp=None, drive=None):
    """One layer: onset and skip in seconds, gain in dB, target pitch or plain speed, pan -1..1."""
    return dict(file=file, at=at, db=db, note=note, speed=speed, skip=skip, length=length, fadein=fadein,
                pan=pan, reverse=reverse, hp=hp, lp=lp, drive=drive)


def R(id, name, character, duration, layers, *, room=.16, wet=.10, kind='signal', lufs=LUFS):
    return dict(id=id, kind=kind, name=name, character=character, duration=duration,
                room=room, wet=wet, lufs=lufs, layers=layers)


def E(*args, **kwargs):
    return R(*args, kind='emote', **kwargs)


SIGNALS = [
    R('danger', '危险', '两下重击 + 闷金属', .5, room=.14, layers=[
        L(K('impactPunch_heavy_000'), 0, -3, length=.25),
        L('vsco/BrakeDrum1_Hammer_v2_Sum.wav', .004, -12, length=.1, lp=2200),
        L(K('impactPunch_heavy_001'), .13, -2, length=.3),
        L('vsco/BrakeDrum1_Hammer_v2_Sum.wav', .134, -11, speed=.94, length=.12, lp=2200),
    ]),
    R('watch', '关注', '轻扫一眼的风声 + 布料', .5, room=.18, layers=[
        L(FS(60013), 0, -6, length=.4, lp=5000, pan=-.2),
        L(K('cloth2'), .03, -14, length=.3, pan=.2),
        L(K('impactSoft_medium_000'), .2, -12, length=.1),
    ]),
    R('together', '集合', '反向镲吸入 + 木鼓落点', .6, room=.2, wet=.12, layers=[
        L('vsco/cymbal-crashshort_v1.wav', 0, -14, length=.24, reverse=True, hp=1500, lp=6000),
        L(LOG, .24, -5, length=.12, lp=2500),
        L(K('impactPunch_medium_000'), .24, -8, length=.2),
    ]),
    R('agree', '同意', '一记木块 + 轻啵', .4, wet=.08, layers=[
        L(K('impactWood_light_000'), 0, -5, length=.1, lp=3500),
        L(FS(401542), .01, -9, length=.2),
        L(K('impactSoft_medium_000'), 0, -12, length=.1),
    ]),
    R('help', '求助', '三下渐急的木鼓敲击', .5, room=.14, layers=[
        L(LOG, 0, -8, length=.1, lp=2500),
        L(LOG, .1, -7, speed=1.03, length=.1, lp=2500),
        L(LOG, .18, -5, speed=1.06, length=.12, lp=2500),
        L(K('impactSoft_medium_000'), .18, -10, length=.1),
    ]),
    R('attention', '注意', '图钉按下的闷响', .4, room=.12, layers=[
        L(K('drop_002'), 0, -5, length=.15, lp=4000),
        L(K('impactSoft_medium_000'), 0, -8, length=.12),
        L(K('impactWood_light_000'), .005, -12, length=.08, lp=3000),
    ]),
    R('question', '疑问', '两下木质轻敲，第二下上挑', .42, room=.12, wet=.08, layers=[
        L(K('impactWood_light_000'), 0, -6, length=.08, lp=3500),
        L(K('impactWood_light_000'), .14, -5, speed=1.25, length=.1, lp=3500),
        L(CLAVES, .14, -18, speed=.9, length=.04, lp=2500),
    ]),
    R('disagree', '反对', '两下闷沉木头，越敲越低', .45, room=.1, wet=.06, layers=[
        L(K('impactWood_medium_000'), 0, -5, length=.12, lp=2500),
        L(K('impactWood_heavy_000'), .13, -4, speed=.9, length=.2),
        L(K('impactWood_medium_000'), .13, -9, speed=.85, length=.14, lp=2000),
    ]),
]

EMOTES = [
    E('diamond-hands', '钻石手', '握拳闷响 + 水晶碰撞', .45, layers=[
        L(K('impactPunch_medium_000'), 0, -5, length=.2),
        L(K('impactGlass_heavy_000'), .01, -5, length=.24, lp=3500),
    ]),
    E('paper-hands', '纸手', '纸团揉皱 + 一阵风', .65, layers=[
        L(FS(106127), 0, -3, length=.5),
        L(FS(60013), .06, -13, length=.4, hp=600, pan=.3),
    ]),
    E('copium', '续命', '面罩深吸 + 气阀嘶声', .75, room=.18, layers=[
        L(FS(65620), 0, -3, skip=.3, length=.6, fadein=.08, hp=300),
        L(FS(234782), .05, -20, length=.4, fadein=.1, hp=2000, lp=5000),
    ]),
    E('rekt', '麻了', '重击 + 滑哨下坠', .75, layers=[
        L(K('impactPunch_heavy_000'), 0, -4, length=.3),
        L(FS(497093), .08, -10, speed=1.6, length=.5),
    ]),
    E('fomo', '上头', '滑哨急升 + 冲出去的风声', .6, layers=[
        L(FS(497092), 0, -9, speed=2.0, length=.45),
        L(FS(60013), .25, -8, length=.35, lp=6000),
    ]),
    E('sold-early', '卖飞', '扑翅飞走 + 远去的风', .7, room=.2, layers=[
        L(FS(240469), 0, 0, length=.5, pan=.25),
        L(FS(60013), .25, -14, length=.4, lp=5000, pan=.5),
    ]),
    E('quiet-win', '偷赚', '硬币轻碰 + 收进口袋', .55, layers=[
        L(K('handleCoins2'), 0, -5, length=.3, lp=6000),
        L(K('cloth4'), .2, -12, length=.3, lp=5000),
    ]),
    E('bagholder', '死拿', '皮袋落怀 + 闷硬币 + 布料挤压', .62, room=.12, layers=[
        L(K('dropLeather'), 0, -3, length=.35),
        L(K('handleCoins'), .02, -11, length=.45, lp=4000),
        L(K('cloth3'), .15, -12, length=.3),
    ]),
    E('gm', '早安', '挥爪两下 + 轻啵', .55, layers=[
        L(K('cloth2'), 0, -8, length=.2, pan=-.2),
        L(K('cloth2'), .16, -8, speed=1.08, length=.2, pan=.2),
        L(FS(401542), .3, -10, length=.2),
    ]),
    E('dyor', '研究一下', '两下嗒嗒 + 翻一页', .65, layers=[
        L(K('tick_001'), 0, -10, length=.03, lp=4000),
        L(K('tick_001'), .09, -10, length=.03, lp=4000),
        L(K('bookFlip1'), .16, -8, skip=.5, length=.3, lp=6000),
    ]),
    E('no-fud', '别吓我', '捂耳布料声 + 闷住的世界', .5, room=.1, wet=.06, layers=[
        L(K('cloth1'), 0, -8, length=.3),
        L(K('impactSoft_heavy_000'), .02, -4, length=.3, lp=900),
    ]),
    E('touch-grass', '冷静一下', '草叶沙沙 + 长舒一口气', .8, room=.22, layers=[
        L(FS(178615), 0, -10, length=.55, fadein=.05, pan=-.25, lp=6000),
        L(FS(242909), .1, -4, length=.6, hp=200),
    ]),
    E('alpha', '有发现', 'Popcat 嘴巴啵 + 第二声啵', .45, layers=[
        L(FS(47498), 0, -2, skip=.085, length=.25),
        L(FS(401542), .1, -9, speed=1.3, length=.15, pan=.3),
    ]),
    E('lurker', '潜水围观', '轻嗒 + 布料挪动', .5, room=.12, layers=[
        L(K('tick_001'), 0, -14, length=.03, lp=4000),
        L(K('cloth3'), .05, -12, length=.3),
        L(K('tick_001'), .2, -14, length=.03, lp=4000),
    ]),
    E('send-it', '冲', '卡通啵 + 风声冲起 + 重拍', .55, layers=[
        L(FS(245646), 0, -6, length=.2),
        L(FS(60013), .02, -8, length=.35, hp=400),
        L(K('impactPunch_medium_000'), .15, -5, length=.2),
    ]),
    E('exit-liquidity', '接盘', '瓷盘碰响 + 放稳', .55, layers=[
        L(K('impactPlate_medium_001'), 0, -4, length=.35, lp=4000),
        L(K('impactPlate_light_000'), .12, -12, speed=.95, length=.2, lp=3500, pan=.3),
        L(K('impactSoft_medium_000'), .12, -12, length=.1),
    ]),
    E('rugged', '被 Rug 了', '地毯抽走 + 摔倒 + 滑哨', .8, layers=[
        L(FS(19312), 0, -6, length=.4, hp=300),
        L(K('cloth1'), 0, -10, length=.3),
        L(K('impactSoft_heavy_000'), .22, -4, length=.35, lp=1500),
        L(K('impactPunch_heavy_000'), .22, -10, length=.3),
        L(FS(497093), .3, -16, speed=2.0, length=.4),
    ]),
    E('trapped', '套牢', '泳圈吱声 + 挣扎', .55, layers=[
        L(FS(187343), 0, -6, speed=.85, length=.42, lp=3000),
        L(K('cloth4'), .15, -12, length=.3, lp=4000),
    ]),
    E('run', '先跑为敬', '风声 + 一串远去的脚步', .56, room=.14, layers=[
        L(FS(60013), 0, -6, length=.45, pan=.3),
        L(K('footstep_carpet_000'), .05, -8, length=.14, pan=-.1),
        L(K('footstep_carpet_001'), .13, -9, length=.14, pan=.1),
        L(K('footstep_carpet_002'), .21, -11, length=.14, pan=.25),
        L(K('footstep_carpet_003'), .29, -13, length=.14, pan=.4),
    ]),
    E('popcorn', '吃瓜', '咬一大口西瓜', .6, layers=[
        L(FS(275015), 0, -3, skip=.3, length=.4),
        L(FS(348112), .02, -10, length=.3, lp=6000),
    ]),
    E('im-fine', '嘴硬', '吸鼻子 + 擦一下', .65, layers=[
        L(FS(151218), 0, -5, skip=.08, length=.5, lp=3500),
        L(K('cloth4'), .38, -12, length=.25, lp=4000),
    ]),
    E('whale', '有大户', '水花 + 冒泡', .75, room=.28, wet=.16, layers=[
        L(FS(321490), 0, -5, skip=.2, length=.45),
        L(FS(611642), .25, -9, length=.3, pan=.3),
        L(FS(611642), .4, -14, speed=.85, length=.3, pan=-.3),
    ]),
    E('shill', '喊一嗓子', '喇叭开关 + 扩音小号两声', .6, layers=[
        L(K('switch_002'), 0, -12, length=.05),
        L(TRUMPET, .03, -4, note='D5', length=.15, hp=600, lp=3500, drive=12),
        L(TRUMPET, .17, -3, note='G5', length=.3, hp=600, lp=3500, drive=12),
    ]),
    E('wen', '还要多久', '钟表滴答 + 不耐烦敲两下', .8, layers=[
        L(FS(54848), 0, -6, length=.62),
        L(K('impactWood_light_000'), .58, -10, length=.08, lp=3500),
        L(K('impactWood_light_000'), .66, -10, speed=1.05, length=.08, lp=3500),
    ]),
    E('gas', 'Gas 好贵', '蒸汽喷出 + 一股烟', .6, layers=[
        L(FS(90143), 0, -13, length=.45, hp=800, lp=3000),
        L(FS(714257), 0, -4, length=.4),
        L(K('impactPunch_medium_000'), 0, -14, length=.15),
    ]),
    E('airdrop', '空投来了', '降落伞展开 + 落地 + 硬币', .7, room=.18, layers=[
        L(FS(393056), 0, 0, skip=.3, length=.4),
        L(K('impactSoft_heavy_000'), .36, -6, length=.3, lp=2000),
        L(K('handleCoins2'), .38, -12, length=.25, lp=6000),
    ]),
    E('gn', '晚安', '拉被子 + 轻叹一口气', .8, room=.24, wet=.12, layers=[
        L(K('cloth1'), 0, -8, length=.35, lp=4000),
        L(FS(242909), .18, -6, length=.6, hp=200, lp=4000),
    ]),
]

# Hovering a wheel slot: a single soft click, well below the signals.
INTERFACE = [
    R('tick', '轮盘切换', '一下轻嗒', .12, kind='interface', room=.05, wet=.02, lufs=-30, layers=[
        L(K('tick_001'), 0, -6, length=.03, lp=3500),
        L(K('impactWood_light_000'), 0, -14, length=.06, lp=2500),
    ]),
]

RECIPES = SIGNALS + EMOTES + INTERFACE


def read(path):
    with AudioFile(str(path)).resampled_to(RATE) as f:
        return f.read(f.frames).mean(axis=0).astype(np.float32)


# The trumpet's second harmonic outweighs its fundamental; pin the measured D5.
_pitch = {TRUMPET: 591.0}


def trim(data):
    # Keep 1 ms before the actual contact.
    active = np.flatnonzero(np.abs(data) > np.max(np.abs(data)) * .006)
    assert len(active)
    return data[max(0, active[0] - 48):]


def prepare(layer):
    data = trim(read(SOURCES / layer['file']))[int(layer['skip'] * RATE):]
    speed = hz(layer['note']) / _pitch[layer['file']] if layer['note'] else layer['speed']
    assert .6 < speed < 2.1, (layer['file'], layer['note'], speed)
    data = np.interp(np.arange(0, len(data), speed), np.arange(len(data)), data).astype(np.float32)
    data = data[:int(layer['length'] * RATE)]
    data /= max(float(np.max(np.abs(data))), .001)
    attack = min(max(24, int(layer['fadein'] * RATE)), len(data))
    release = min(int(.04 * RATE), len(data))
    data[:attack] *= np.linspace(0, 1, attack)
    data[-release:] *= np.linspace(1, 0, release) ** 2
    if layer['reverse']:
        data = data[::-1].copy()
    filters = []
    if layer['hp']:
        filters.append(HighpassFilter(cutoff_frequency_hz=layer['hp']))
    if layer['lp']:
        filters.append(LowpassFilter(cutoff_frequency_hz=layer['lp']))
    if layer['drive']:
        # Megaphone colour: band-limited, then driven.
        filters.append(Distortion(drive_db=layer['drive']))
    if filters:
        data = Pedalboard(filters)(data, RATE)
        data /= max(float(np.max(np.abs(data))), .001)
    data *= 10 ** (layer['db'] / 20)
    # Constant-power pan into stereo.
    angle = (layer['pan'] + 1) * np.pi / 4
    return np.stack([data * np.cos(angle), data * np.sin(angle)])


# ITU-R BS.1770 K-weighting at 48 kHz: high shelf, then RLB high-pass.
K_WEIGHTING = [([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, .73248077421585]),
               ([1, -2, 1], [1, -1.99004745483398, .99007225036621])]


def biquad(x, b, a):
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        out = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        x2, x1, y2, y1 = x1, v, y1, out
        y[i] = out
    return y


def integrated_loudness(data, block=.2):
    """BS.1770 gated loudness; 200 ms blocks (75% overlap) because signals are shorter than 400 ms windows allow."""
    weighted = np.stack([biquad(biquad(ch.astype(np.float64), *K_WEIGHTING[0]), *K_WEIGHTING[1]) for ch in data])
    # The wheel tick is shorter than one block: measure it as a single block.
    size = min(int(block * RATE), weighted.shape[1])
    step = max(1, size // 4)
    power = np.array([np.mean(weighted[:, i:i + size] ** 2, axis=1).sum()
                      for i in range(0, weighted.shape[1] - size + 1, step)])
    level = lambda z: -.691 + 10 * np.log10(np.mean(z))
    power = power[-.691 + 10 * np.log10(power + 1e-12) > -70]
    return float(level(power[-.691 + 10 * np.log10(power) > level(power) - 10]))


def sample_peak(data):
    # Linear interpolation includes every sample and preserves the sample peak.
    n = data.shape[1]
    up = np.stack([np.interp(np.arange(0, n, .25), np.arange(n), ch) for ch in data])
    return float(np.max(np.abs(up)))


def metrics(data):
    return dict(durationMs=round(data.shape[1] / RATE * 1000), lufs=round(integrated_loudness(data), 2),
                samplePeakDb=round(20 * np.log10(max(sample_peak(data), 1e-9)), 2))


def render(recipe):
    mix = np.zeros((2, round(recipe['duration'] * RATE)), dtype=np.float32)
    for layer in recipe['layers']:
        data = prepare(layer)
        offset = round(layer['at'] * RATE)
        count = min(data.shape[1], mix.shape[1] - offset)
        mix[:, offset:offset + count] += data[:, :count]
    bus = Pedalboard([
        HighpassFilter(cutoff_frequency_hz=140),
        # Soft top end: no presence boost, a gentle shelf and an 8 kHz ceiling keep dings from piercing.
        HighShelfFilter(cutoff_frequency_hz=4500, gain_db=-4.0),
        LowpassFilter(cutoff_frequency_hz=8000),
        Compressor(threshold_db=-18, ratio=2.2, attack_ms=6, release_ms=80),
        Delay(delay_seconds=.085, feedback=.12, mix=.06),
        Reverb(room_size=recipe['room'], damping=.6, wet_level=recipe['wet'], dry_level=1, width=1),
    ])
    mix = bus(mix, RATE)
    mix -= mix.mean(axis=1, keepdims=True)
    tail = round(.08 * RATE)
    mix[:, -tail:] *= np.linspace(1, 0, tail) ** 2
    mix[:, :24] *= np.linspace(0, 1, 24)
    # Reach the loudness target first; sharp foley transients (bites, pops) are then limited, not the whole sound.
    target = recipe['lufs']
    mix *= 10 ** ((target - integrated_loudness(mix)) / 20)
    if sample_peak(mix) > 10 ** (PEAK_DB / 20):
        mix = Limiter(threshold_db=PEAK_DB - 1, release_ms=40)(mix, RATE)
    gain = min(10 ** ((target - integrated_loudness(mix)) / 20), 10 ** (PEAK_DB / 20) / sample_peak(mix))
    return (mix * gain).astype(np.float32)


def pin_mp4_timestamp(path, timestamp):
    """Set version-0 movie, track and media timestamps without touching AAC data."""
    data = bytearray(path.read_bytes())
    count = 0

    def visit(start, end):
        nonlocal count
        while start < end:
            size, kind = struct.unpack_from('>I4s', data, start)
            if size < 8 or start + size > end:
                raise ValueError('Unexpected MP4 atom layout')
            if kind in (b'mvhd', b'tkhd', b'mdhd'):
                if size < 20 or data[start + 8] != 0:
                    raise ValueError('Expected version-0 MP4 timestamps')
                struct.pack_into('>II', data, start + 12, timestamp, timestamp)
                count += 1
            elif kind in (b'moov', b'trak', b'mdia'):
                visit(start + 8, start + size)
            start += size

    visit(0, len(data))
    if count != 3:
        raise ValueError('Expected one movie, track and media timestamp pair')
    path.write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path,
                        help='Write candidate sounds and a manifest to a separate review directory')
    args = parser.parse_args()
    if args.output_dir is not None and args.output_dir.resolve() == OUT.resolve():
        raise SystemExit('--output-dir must be separate from the bundled sounds directory.')
    destination = args.output_dir if args.output_dir is not None else OUT
    expected = json.loads((HERE / 'manifest.json').read_text())['entries']
    expected_by_file = {entry['file']: entry for entry in expected}
    if len(expected_by_file) != len(expected) or set(expected_by_file) != {f"sounds/{r['id']}.m4a" for r in RECIPES}:
        raise SystemExit('Sound manifest must contain exactly one output per recipe.')
    provenance = json.loads((ROOT / 'licenses/signal-sounds/sources.json').read_text())
    for source in provenance['recordings']:
        path = ROOT / source['file']
        if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            raise SystemExit(f"Source SHA-256 mismatch: {source['file']}")
    results = []
    entries = []
    mismatches = []
    # Bundled outputs are published only after every render matches its checksum.
    with tempfile.TemporaryDirectory(prefix='palside-signal-sounds-') as directory:
        staging = Path(directory)
        for recipe in RECIPES:
            key = recipe['id']
            mix = render(recipe)
            master = staging / (key + '.wav')
            with AudioFile(str(master), 'w', RATE, 2, bit_depth=24) as f:
                f.write(mix)
            output = staging / (key + '.m4a')
            subprocess.run([ENCODER, '-f', 'm4af', '-d', 'aac', '-b', '128000', str(master), str(output)], check=True)
            with AudioFile(str(output)).resampled_to(RATE) as f:
                decoded = f.read(f.frames)
            info = metrics(decoded)
            assert np.isfinite(decoded).all() and abs(info['lufs'] - recipe['lufs']) < 2.5, (key, info)
            assert info['samplePeakDb'] < -.5 and abs(info['durationMs'] - recipe['duration'] * 1000) < 30, (key, info)
            assert output.stat().st_size < 20000
            entry = expected_by_file[f'sounds/{output.name}']
            pin_mp4_timestamp(output, entry['mp4Timestamp'])
            data = output.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            entries.append(dict(file=entry['file'], bytes=len(data), sha256=digest, mp4Timestamp=entry['mp4Timestamp']))
            if len(data) != entry['bytes'] or digest != entry['sha256']:
                mismatches.append(key)
            if mismatches and args.output_dir is None:
                raise SystemExit(f'{key}: encoded bytes differ from manifest; no outputs published. '
                                 'The Apple encoder or audio environment may differ from the documented build.')
            results.append(output)
            print(f"{key:16} {info['durationMs']:4}ms {len(data):6}B {info['lufs']:6} LUFS {info['samplePeakDb']:6} dBFS")
        destination.mkdir(parents=True, exist_ok=True)
        for output in results:
            shutil.copyfile(output, destination / output.name)
        if args.output_dir is not None:
            (destination / 'manifest.json').write_text(json.dumps(dict(entries=entries), indent=2) + '\n')
    if mismatches:
        raise SystemExit('Candidate encodings differ from bundled hashes: ' + ', '.join(mismatches))


if __name__ == '__main__':
    main()
