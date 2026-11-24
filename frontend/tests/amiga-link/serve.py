"""Local static server for Amiga Link Play tests (never used in production).

Serves frontend/public at /, this folder at /__linktest/, and two local-only
files supplied on the command line (they are never copied into the repo):
  /__linktest/kick.rom   <- --kickstart PATH   (optional; AROS is used without it)
  /__linktest/game.adf   <- --game PATH        (optional)
"""
import argparse, functools, http.server, pathlib
here = pathlib.Path(__file__).resolve().parent
public = here.parents[1] / "public"
ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--kickstart")
ap.add_argument("--game")
args = ap.parse_args()
extra = {"/__linktest/kick.rom": args.kickstart, "/__linktest/game.adf": args.game}

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean in extra and extra[clean]:
            return extra[clean]
        if clean.startswith("/__linktest/"):
            return str(here / clean[len("/__linktest/"):])
        return super().translate_path(path)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", args.port), functools.partial(Handler, directory=str(public))).serve_forever()
