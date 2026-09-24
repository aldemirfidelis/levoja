"""
Gera os ícones dos apps (Expo) a partir de um desenho vetorial simples (pino de localização).

Uso:  python scripts/app-icons.py
Requer: Pillow (pip install pillow)

Saída (por app): icon.png, adaptive-foreground.png, adaptive-monochrome.png,
splash-icon.png, notification-icon.png e logo.png em <app>/assets/.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND = (255, 90, 31, 255)
DARK = (17, 24, 39, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

APPS = {
    # Cliente: pino branco sobre laranja.
    "mobile-client": {"background": BRAND, "pin": WHITE, "dot": BRAND},
    # Entregador: pino laranja sobre grafite (diferencia os dois apps na tela inicial).
    "mobile-driver": {"background": DARK, "pin": BRAND, "dot": DARK},
}


def draw_pin(size: int, scale: float, pin, dot, background=CLEAR, supersample: int = 4) -> Image.Image:
    """Pino: círculo + ponta, com um furo central. `scale` = fração da tela ocupada."""
    big = size * supersample
    image = Image.new("RGBA", (big, big), background)
    draw = ImageDraw.Draw(image)
    height = big * scale
    radius = height * 0.36
    cx = big / 2
    top = (big - height) / 2
    cy = top + radius
    tip_y = top + height
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=pin)
    draw.polygon([(cx - radius * 0.86, cy + radius * 0.52), (cx + radius * 0.86, cy + radius * 0.52), (cx, tip_y)], fill=pin)
    hole = radius * 0.42
    draw.ellipse((cx - hole, cy - hole, cx + hole, cy + hole), fill=dot)
    return image.resize((size, size), Image.LANCZOS)


def rounded(image: Image.Image, radius_ratio: float = 0.22) -> Image.Image:
    size = image.size[0]
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4, size * 4), radius=int(size * 4 * radius_ratio), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), CLEAR)
    out.paste(image, (0, 0), mask)
    return out


def main() -> None:
    for app, colors in APPS.items():
        assets = ROOT / app / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        draw_pin(1024, 0.58, colors["pin"], colors["dot"], colors["background"]).save(assets / "icon.png")
        # Ícone adaptativo (Android): conteúdo dentro da zona segura central (~66%).
        draw_pin(1024, 0.42, colors["pin"], colors["dot"] if colors["dot"] != CLEAR else colors["background"]).save(assets / "adaptive-foreground.png")
        draw_pin(1024, 0.42, WHITE, CLEAR).save(assets / "adaptive-monochrome.png")
        draw_pin(512, 0.7, colors["pin"], colors["dot"]).save(assets / "splash-icon.png")
        # Notificação (Android): branco sobre transparente, 96x96.
        draw_pin(96, 0.8, WHITE, CLEAR).save(assets / "notification-icon.png")
        rounded(draw_pin(256, 0.58, colors["pin"], colors["dot"], colors["background"])).save(assets / "logo.png")
        print(f"ok: {app}/assets")


if __name__ == "__main__":
    main()
