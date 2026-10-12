"""Run Pocket Cricket without installing any Python packages."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description="Start Pocket Cricket locally")
parser.add_argument("--port", type=int, default=8000)
parser.add_argument("--host", default="127.0.0.1")
args = parser.parse_args()
handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
server = ThreadingHTTPServer((args.host, args.port), handler)
print(f"Pocket Cricket is live at http://{args.host}:{args.port}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
