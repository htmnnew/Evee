#!/usr/bin/env python3
"""Re-shoot the README screenshots by driving the live app in headless Chromium.

The six PNGs the README embeds go stale every time the UI moves — the chat bar
becoming the bottom-right orb is what stranded the last set. This re-takes all
of them at the original 1440x900 in one command, so refreshing them is cheap
enough to actually do.

    python3 serve.py 8000          # in another shell
    python3 tools/shoot_screenshots.py

Needs Playwright, which is NOT in requirements.txt — it is a dev-only tool and
the server has no business carrying a browser:

    python3 -m pip install --user playwright
    python3 -m playwright install chromium

Writes into screenshots/ by default; pass a directory to stage them elsewhere
first. `room-view.png` is left alone — the README doesn't reference it.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = "http://localhost:8000/Evee.html"
W, H = 1440, 900
SCALE = 1  # bump to 2 for retina-resolution shots

# The room shots the README embeds. Names must match world.jsx exactly —
# note it is Bathroom *2* and Bedroom *1* that were originally shot.
ROOM_SHOTS = [
    ("office-view.png", "Office"),
    ("kitchen-view.png", "Kitchen"),
    ("bathroom-view.png", "Bathroom 2"),
    ("bedroom-view.png", "Bedroom 1"),
]

# Room hit zones are unlabelled <path>s, so there is nothing to select by name.
# Mirroring HomeScene's own `rooms.filter(r => !r.noInteract)` render order maps
# a room to its zone, and the length check fails loudly if that ever drifts.
ENTER_ROOM = """(name) => {
  const rooms = window.APARTMENT.rooms.filter(r => !r.noInteract);
  const idx = rooms.findIndex(r => r.name === name);
  if (idx < 0) throw new Error('no such room: ' + name);
  const zones = [...document.querySelectorAll('svg path')]
    .filter(p => p.style.cursor === 'pointer');
  if (zones.length !== rooms.length)
    throw new Error(`hit-zone mismatch: ${zones.length} zones vs ${rooms.length} rooms`);
  zones[idx].dispatchEvent(new MouseEvent('click', { bubbles: true }));
}"""

# Babel transforms the nine .jsx files in-browser, so "loaded" is not "rendered".
READY = """() => !!(window.APARTMENT && window.APARTMENT.rooms
  && document.querySelectorAll('svg path').length > 20)"""

# Evee's eye blinks on a loop, so a capture can catch it shut. Redefining the
# keyframe holds it open without touching breathing/glow/swirl, which should
# stay live so the orb still looks the way it does in use. Appended to <body>:
# the component renders its own <style> there, and for @keyframes last wins.
# (Playwright's reduced_motion="reduce" would also work — the app honors it at
# chat.jsx's `prefers-reduced-motion` rule — but it freezes the glow at full
# opacity, which reads as a brighter halo than the orb really has.)
NO_BLINK = """() => {
  const s = document.createElement('style');
  s.textContent = '@keyframes eveeBlink { 0%,100% { transform: scaleY(1); } }';
  document.body.appendChild(s);
}"""


def settle(page, ms=700):
    """Let fonts, gradients and the orb's entry animation land."""
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(ms)


def shot(page, out, name):
    out.mkdir(parents=True, exist_ok=True)
    settle(page)
    page.screenshot(path=str(out / name))
    print(f"  wrote {name}")


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "screenshots"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": W, "height": H}, device_scale_factor=SCALE
        )
        # NOT networkidle: the livereload SSE stream never goes idle.
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(READY, timeout=30_000)
        page.evaluate(NO_BLINK)

        print("home view")
        shot(page, out, "home-view.png")

        for filename, room in ROOM_SHOTS:
            print(room)
            page.evaluate(ENTER_ROOM, room)
            # Confirm we actually landed in that room before shooting.
            page.wait_for_function(
                "(n) => document.body.innerText.includes(n)", arg=room, timeout=10_000
            )
            shot(page, out, filename)
            page.keyboard.press("Escape")  # back to home
            page.wait_for_function(READY, timeout=10_000)
            page.wait_for_timeout(400)

        print("floor-plan editor")
        page.get_by_role("button", name="⋮").click()
        page.get_by_role("button", name="Create Floor Plan").click()
        page.wait_for_function(
            "() => document.body.innerText.includes('Floor-plan editor')", timeout=10_000
        )
        shot(page, out, "floor-plan-editor.png")

        browser.close()
    print(f"done → {out}")


if __name__ == "__main__":
    main()
