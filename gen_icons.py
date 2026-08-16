import zlib, struct, math

def write_png(path, size, pixels):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            r, g, b = pixels[y][x]
            raw += bytes((r, g, b))
    idat = zlib.compress(bytes(raw), 9)
    with open(path, 'wb') as f:
        f.write(sig)
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', idat))
        f.write(chunk(b'IEND', b''))

def polygon_mask(size, points):
    # points in pixel coords, returns 2D bool list via scanline fill
    mask = [[False] * size for _ in range(size)]
    n = len(points)
    for y in range(size):
        yc = y + 0.5
        xs = []
        for i in range(n):
            x1, y1 = points[i]
            x2, y2 = points[(i + 1) % n]
            if y1 == y2:
                continue
            if min(y1, y2) <= yc < max(y1, y2):
                t = (yc - y1) / (y2 - y1)
                xs.append(x1 + t * (x2 - x1))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            xstart = max(0, int(math.ceil(xs[i] - 0.5)))
            xend = min(size - 1, int(math.floor(xs[i + 1] - 0.5)))
            for x in range(xstart, xend + 1):
                mask[y][x] = True
    return mask

def spade_points(cx, cy, scale, n=240):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * scale, cy + y * scale))
    return pts

def stem_points(cx, cy, w, h):
    return [(cx - w, cy), (cx + w, cy), (cx + w * 0.35, cy + h), (cx - w * 0.35, cy + h)]

def make_icon(size, path, maskable=False):
    bg = (16, 92, 62)
    fg = (255, 255, 255)
    pixels = [[bg for _ in range(size)] for _ in range(size)]

    margin = size * (0.14 if maskable else 0.08)
    r = size * 0.22
    for y in range(size):
        for x in range(size):
            inside = True
            if x < margin + r and y < margin + r:
                if (x - (margin + r)) ** 2 + (y - (margin + r)) ** 2 > r * r:
                    inside = False
            elif x > size - margin - r and y < margin + r:
                if (x - (size - margin - r)) ** 2 + (y - (margin + r)) ** 2 > r * r:
                    inside = False
            elif x < margin + r and y > size - margin - r:
                if (x - (margin + r)) ** 2 + (y - (size - margin - r)) ** 2 > r * r:
                    inside = False
            elif x > size - margin - r and y > size - margin - r:
                if (x - (size - margin - r)) ** 2 + (y - (size - margin - r)) ** 2 > r * r:
                    inside = False
            if x < margin or x > size - margin or y < margin or y > size - margin:
                inside = False
            if not inside:
                pixels[y][x] = (10, 58, 40)

    cx, cy = size / 2, size / 2 - size * 0.06
    scale = size * 0.016
    pts = spade_points(cx, cy, scale)
    mask = polygon_mask(size, pts)
    stem = stem_points(cx, cy - 13 * scale * -0 + size * 0.16, size * 0.045, size * 0.14)
    stem = stem_points(cx, size * 0.62, size * 0.05, size * 0.16)
    stem_mask = polygon_mask(size, stem)

    for y in range(size):
        for x in range(size):
            if mask[y][x] or stem_mask[y][x]:
                pixels[y][x] = fg

    write_png(path, size, pixels)

make_icon(192, "icons/icon-192.png", maskable=False)
make_icon(512, "icons/icon-512.png", maskable=False)
make_icon(512, "icons/icon-maskable-512.png", maskable=True)
print("done")
