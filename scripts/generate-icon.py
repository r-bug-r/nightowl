"""Generate crisp multi-resolution Nightowl Windows icon (build/icon.ico & build/icon.png)."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
BUILD_DIR.mkdir(parents=True, exist_ok=True)


def draw_nightowl(size: int) -> Image.Image:
    # Supersample 4x for smooth anti-aliased edges
    ss = 4
    w = size * ss
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def s(v: float) -> float:
        return (v / 24.0) * w

    # Outer nocturnal spruce medallion with golden ring
    pad = s(1.0)
    d.ellipse([pad, pad, w - pad, w - pad], fill=(5, 13, 10, 255), outline=(251, 191, 36, 255), width=max(1, round(s(1.35))))

    # Subtle inner emerald ring
    pad2 = s(2.4)
    d.ellipse([pad2, pad2, w - pad2, w - pad2], outline=(20, 62, 44, 210), width=max(1, round(s(0.45))))

    # Owl head & body silhouette (approximated cleanly from OwlIcon.tsx 24x24 viewBox)
    body_pts = [
        (s(4.8), s(5.6)),
        (s(8.1), s(7.9)),
        (s(12.0), s(7.2)),
        (s(15.9), s(7.9)),
        (s(19.2), s(5.6)),
        (s(20.0), s(9.6)),
        (s(19.5), s(14.6)),
        (s(17.5), s(18.6)),
        (s(14.8), s(20.0)),
        (s(9.2), s(20.0)),
        (s(6.5), s(18.6)),
        (s(4.5), s(14.6)),
        (s(4.0), s(9.6)),
    ]
    d.polygon(body_pts, fill=(11, 25, 20, 255))
    d.line(body_pts + [body_pts[0], body_pts[1]], fill=(240, 253, 244, 255), width=max(1, round(s(0.95))), joint="curve")

    # Expressive amber V-brow ridge
    brow_pts = [(s(5.8), s(8.4)), (s(12.0), s(10.6)), (s(18.2), s(8.4))]
    d.line(brow_pts, fill=(251, 191, 36, 245), width=max(1, round(s(0.95))), joint="curve")

    # Eye sockets + bright amber irises + pupils + catchlights
    for cx in (8.4, 15.6):
        cy = 12.1
        # Socket
        r_sock = 3.15
        d.ellipse(
            [s(cx - r_sock), s(cy - r_sock), s(cx + r_sock), s(cy + r_sock)],
            fill=(4, 9, 7, 255),
            outline=(240, 253, 244, 235),
            width=max(1, round(s(0.65))),
        )
        # Amber iris
        r_iris = 2.65
        d.ellipse(
            [s(cx - r_iris), s(cy - r_iris), s(cx + r_iris), s(cy + r_iris)],
            fill=(251, 191, 36, 255),
        )
        # Pupil
        r_pup = 1.35
        d.ellipse(
            [s(cx - r_pup), s(cy - r_pup), s(cx + r_pup), s(cy + r_pup)],
            fill=(5, 13, 10, 255),
        )
        # Main catchlight
        r_hi = 0.62
        hx, hy = cx - 0.78, cy - 0.85
        d.ellipse(
            [s(hx - r_hi), s(hy - r_hi), s(hx + r_hi), s(hy + r_hi)],
            fill=(255, 255, 255, 255),
        )

    # Diamond beak
    beak_pts = [
        (s(12.0), s(12.9)),
        (s(13.1), s(14.5)),
        (s(12.0), s(16.6)),
        (s(10.9), s(14.5)),
    ]
    d.polygon(beak_pts, fill=(245, 158, 11, 255))

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    rendered = [draw_nightowl(sz) for sz in sizes]
    png_path = BUILD_DIR / "icon.png"
    ico_path = BUILD_DIR / "icon.ico"

    rendered[-1].save(png_path, format="PNG")
    rendered[-1].save(ico_path, format="ICO", sizes=[(sz, sz) for sz in sizes])
    print(f"Wrote {png_path} and {ico_path}")


if __name__ == "__main__":
    main()
