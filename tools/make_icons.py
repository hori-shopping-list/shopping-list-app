"""アプリアイコン（黒背景に黄色のカート）を生成する。外部ライブラリは使わない。

使い方（リポジトリの直下で）:
    python tools/make_icons.py
"""
import math
import os
import struct
import zlib

BG = (0, 0, 0)
FG = (0xFF, 0xD4, 0x00)

# app.js のカートアイコンと同じ形（24×24 のグリッド）
POLYLINE = [(1.5, 3), (5, 3), (7.6, 15), (19.5, 15), (22, 7), (6, 7)]
WHEELS = [(9.5, 19.5, 1.6), (17.5, 19.5, 1.6)]
STROKE = 2.0
CENTER = (11.75, 11.75)  # 線幅を含めた外形の中心


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size, cart_frac):
    """cart_frac: アイコンの一辺に対する、24グリッドの一辺の比率"""
    unit = size * cart_frac / 24  # 1グリッドあたりのピクセル数
    segs = list(zip(POLYLINE, POLYLINE[1:]))
    half = STROKE / 2
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG のフィルタ種別（なし）
        gy = (y + 0.5 - size / 2) / unit + CENTER[1]
        for x in range(size):
            gx = (x + 0.5 - size / 2) / unit + CENTER[0]
            d = min(seg_dist(gx, gy, a[0], a[1], b[0], b[1]) for a, b in segs)
            for cx, cy, r in WHEELS:
                d = min(d, abs(math.hypot(gx - cx, gy - cy) - r))
            # 線の縁からの距離をピクセルに直して、なめらかに塗る
            cov = max(0.0, min(1.0, 0.5 + (half - d) * unit))
            row += bytes(round(BG[i] + (FG[i] - BG[i]) * cov) for i in range(3))
        rows.append(bytes(row))
    return b''.join(rows)


def write_png(path, size, raw):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
    os.makedirs(out, exist_ok=True)
    # maskable は中央の円（直径80%）に収まるよう小さめにする
    for name, size, frac in [
        ('icon-192.png', 192, 0.74),
        ('icon-512.png', 512, 0.74),
        ('icon-maskable-512.png', 512, 0.56),
    ]:
        write_png(os.path.join(out, name), size, render(size, frac))
        print('wrote', name)


if __name__ == '__main__':
    main()
