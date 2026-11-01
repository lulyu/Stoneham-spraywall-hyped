#!/usr/bin/env python3
"""Serve the local SAM2 crop annotator and built frontend on a single origin."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hmac
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
from pathlib import Path
import threading
import time
import uuid
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 7292, 5514
CROP_WIDTH, CROP_HEIGHT = 2431, 1838
CONFIG = 'configs/sam2.1/sam2.1_hiera_s.yaml'


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def point(value):
    if not isinstance(value, list) or len(value) != 2 or not all(number(n) for n in value):
        raise ValueError('Each point must contain two finite full-wall normalized coordinates.')
    if not (0 <= value[0] <= CROP_WIDTH / WIDTH and 0 <= value[1] <= CROP_HEIGHT / HEIGHT):
        raise ValueError('Prompts must be inside the top-left crop.')
    return value


def validate_prompts(body):
    prompts = body.get('points', [])
    if not isinstance(prompts, list) or len(prompts) > 64:
        raise ValueError('Use at most 64 points per hold.')
    for prompt in prompts:
        if not isinstance(prompt, dict) or type(prompt.get('label')) is not int or prompt['label'] not in (0, 1):
            raise ValueError('Point label must be 1 (positive) or 0 (negative).')
        point(prompt.get('point'))
    box = body.get('box')
    if box is not None:
        if not isinstance(box, list) or len(box) != 4:
            raise ValueError('Box must contain [left, top, right, bottom].')
        point(box[:2]); point(box[2:])
        if box[0] >= box[2] or box[1] >= box[3]:
            raise ValueError('Box must have positive width and height.')
    if box is None and not any(prompt['label'] == 1 for prompt in prompts):
        raise ValueError('Add a positive point or draw a box first.')
    return prompts, box


class Annotator:
    def __init__(self, checkpoint: Path, storage: Path, threads: int):
        self.storage = storage
        self.lock = threading.Lock()
        self.model_lock = threading.Lock()
        self.status = dict(state='loading', model='SAM2.1 Small', device='checking',
                           image_size=[WIDTH, HEIGHT], crop_size=[CROP_WIDTH, CROP_HEIGHT])
        self.predictor = None
        self.crop_bytes = None
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.executor.submit(self.load, checkpoint, threads)

    def load(self, checkpoint, threads):
        try:
            import torch
            from PIL import Image
            import numpy as np
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            cuda = torch.cuda.is_available()
            self.status.update(device='cuda' if cuda else 'cpu', cuda_available=cuda)
            if not checkpoint.is_file():
                raise RuntimeError(f'Missing checkpoint: {checkpoint}')
            torch.set_num_threads(threads)
            image = Image.open(ROOT / 'public/wall/stoneham-spraywall-canonical.jpg').convert('RGB')
            if image.size != (WIDTH, HEIGHT):
                raise RuntimeError('Canonical image size must be 7292 × 5514.')
            crop = image.crop((0, 0, CROP_WIDTH, CROP_HEIGHT))
            output = io.BytesIO(); crop.save(output, format='JPEG', quality=95)
            self.crop_bytes = output.getvalue()
            model = build_sam2(CONFIG, str(checkpoint), device=self.status['device'], apply_postprocessing=False)
            self.predictor = SAM2ImagePredictor(model)
            with torch.inference_mode():
                self.predictor.set_image(np.array(crop, copy=True))
            self.status.update(state='ready')
            print(f'SAM2 ready on {self.status["device"]}; crop encoded once', flush=True)
        except Exception as error:
            self.status.update(state='error', error=f'{type(error).__name__}: {error}. See docs/sam2-local-annotator.md for setup.')
            print(self.status['error'], flush=True)

    def predict(self, body):
        import cv2
        import numpy as np
        import torch
        prompts, box = validate_prompts(body)
        coords = np.array([[p['point'][0] * WIDTH, p['point'][1] * HEIGHT] for p in prompts], dtype=np.float32) if prompts else None
        labels = np.array([p['label'] for p in prompts], dtype=np.int32) if prompts else None
        rectangle = np.array([box[0] * WIDTH, box[1] * HEIGHT, box[2] * WIDTH, box[3] * HEIGHT], dtype=np.float32) if box else None
        started = time.monotonic()
        with torch.inference_mode():
            masks, scores, _ = self.predictor.predict(point_coords=coords, point_labels=labels, box=rectangle, multimask_output=True)
        results = []
        for mask, score in zip(masks, scores):
            count, components, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
            if count < 2:
                continue
            # Keep the component with most positive prompts, then largest area.
            positives = [p['point'] for p in prompts if p['label'] == 1]
            def rank(label):
                votes = sum(components[min(CROP_HEIGHT - 1, int(y * HEIGHT)), min(CROP_WIDTH - 1, int(x * WIDTH))] == label for x, y in positives)
                return votes, stats[label, cv2.CC_STAT_AREA]
            label = max(range(1, count), key=rank)
            component = (components == label).astype(np.uint8)
            contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contour = max(contours, key=cv2.contourArea)
            epsilon = max(.1, cv2.arcLength(contour, True) * .004)
            polygon = cv2.approxPolyDP(contour, epsilon, True)
            while len(polygon) > 16:
                epsilon *= 1.2
                polygon = cv2.approxPolyDP(contour, epsilon, True)
            if len(polygon) < 3:
                continue
            ys, xs = np.nonzero(component)
            results.append(dict(kind='hold', center=[float(xs.mean()) / WIDTH, float(ys.mean()) / HEIGHT],
                                polygon=[[int(x) / WIDTH, int(y) / HEIGHT] for x, y in polygon[:, 0]],
                                score=float(score)))
        results.sort(key=lambda item: -item['score'])
        return dict(candidates=results, elapsed_seconds=round(time.monotonic() - started, 3))

    def read(self):
        if not self.storage.exists():
            return dict(holds=[])
        data = json.loads(self.storage.read_text())
        if not isinstance(data, dict) or not isinstance(data.get('holds'), list):
            raise RuntimeError('Saved annotation file is invalid; restore it before saving further changes.')
        return data

    def write(self, data):
        data.update(wallId='stoneham-spraywall-v1', image_size=[WIDTH, HEIGHT], crop_box=[0, 0, CROP_WIDTH, CROP_HEIGHT],
                    source='manual-sam2.1-small', updated_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        self.storage.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.storage.with_suffix('.tmp')
        temporary.write_text(json.dumps(data, indent=2) + '\n')
        temporary.replace(self.storage)
        return data


class Handler(SimpleHTTPRequestHandler):
    annotator: Annotator
    access_key: str | None = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def json(self, status, value):
        content = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers(); self.wfile.write(content)

    def log_message(self, format, *args):
        # Authentication links carry a temporary key. Never write it to logs.
        if urlparse(self.path).path == '/auth':
            return
        super().log_message(format, *args)

    def authorized(self):
        if not self.access_key:
            return True
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            supplied = cookie.get('stoneham_session')
            if supplied and hmac.compare_digest(supplied.value, self.access_key):
                return True
        except Exception:
            pass
        self.json(401, dict(error='Open the private access link to enter this annotation session.'))
        return False

    def do_GET(self):
        if urlparse(self.path).path == '/auth' and self.access_key:
            key = parse_qs(urlparse(self.path).query).get('key', [''])[0]
            if not hmac.compare_digest(key, self.access_key):
                return self.json(401, dict(error='Invalid session link.'))
            self.send_response(303)
            self.send_header('Location', '/?annotate=1')
            self.send_header('Set-Cookie', f'stoneham_session={self.access_key}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if not self.authorized():
            return
        path = urlparse(self.path).path
        if path == '/api/sam2/status':
            return self.json(200, self.annotator.status)
        if path == '/api/sam2/annotations':
            try:
                with self.annotator.lock:
                    return self.json(200, self.annotator.read())
            except Exception as error:
                return self.json(500, dict(error=str(error)))
        if path == '/api/sam2/crop.jpg':
            if self.annotator.crop_bytes is None:
                return self.json(503, dict(error='Crop is loading; wait for SAM2 status.'))
            self.send_response(200); self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(self.annotator.crop_bytes)))
            self.end_headers(); return self.wfile.write(self.annotator.crop_bytes)
        if path.startswith('/api/'):
            return self.json(404, dict(error='Unknown API route'))
        return super().do_GET()

    def do_HEAD(self):
        if self.authorized():
            super().do_HEAD()

    def do_POST(self):
        if not self.authorized():
            return
        # Same-origin browser requests only. No permissive CORS on this local tool.
        origin = self.headers.get('Origin')
        if origin and urlparse(origin).netloc != self.headers.get('Host'):
            return self.json(403, dict(error='Use the annotator page on the same origin.'))
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 32768:
                raise ValueError('Request body must be between 1 and 32768 bytes.')
            if self.headers.get_content_type() != 'application/json':
                raise ValueError('Send JSON with Content-Type application/json.')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('Request must be a JSON object.')
            path = urlparse(self.path).path
            if path == '/api/sam2/predict':
                validate_prompts(body)
                if self.annotator.status['state'] != 'ready':
                    return self.json(503, dict(error='SAM2 is not ready. Check the status message.'))
                if not self.annotator.model_lock.acquire(blocking=False):
                    return self.json(409, dict(error='Another prediction is running. Try again shortly.'))
                try:
                    return self.json(200, self.annotator.predict(body))
                finally:
                    self.annotator.model_lock.release()
            if path == '/api/sam2/accept':
                hold = body.get('hold')
                if not isinstance(hold, dict) or not isinstance(hold.get('polygon'), list) or not 3 <= len(hold['polygon']) <= 16:
                    raise ValueError('Accept requires a polygon with 3–16 vertices.')
                point(hold.get('center'))
                for vertex in hold['polygon']:
                    point(vertex)
                clean = dict(id=f'manual-{uuid.uuid4().hex[:12]}', kind='hold', center=hold['center'], polygon=hold['polygon'])
                with self.annotator.lock:
                    data = self.annotator.read()
                    data['holds'].append(clean)
                    return self.json(200, self.annotator.write(data))
            if path == '/api/sam2/delete':
                identifier = body.get('id')
                if not isinstance(identifier, str):
                    raise ValueError('Choose a saved hold to delete.')
                with self.annotator.lock:
                    data = self.annotator.read()
                    if not any(hold['id'] == identifier for hold in data['holds']):
                        return self.json(404, dict(error='Hold no longer exists; refresh the page.'))
                    data['holds'] = [hold for hold in data['holds'] if hold['id'] != identifier]
                    return self.json(200, self.annotator.write(data))
            return self.json(404, dict(error='Unknown API route'))
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            return self.json(400, dict(error=str(error)))
        except Exception as error:
            return self.json(500, dict(error=f'{type(error).__name__}: {error}'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--storage', type=Path, default=ROOT / 'artifacts/manual-annotations/holds.json')
    parser.add_argument('--access-key-file', type=Path, help='Optional private session key file for HTTPS preview access.')
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error('--threads must be positive')
    if not (ROOT / 'dist/index.html').exists():
        parser.error('Run npm run build before starting the annotation server.')
    if args.access_key_file:
        Handler.access_key = args.access_key_file.read_text().strip()
        if len(Handler.access_key) < 32:
            parser.error('Session key must contain at least 32 characters.')
    Handler.annotator = Annotator(args.checkpoint, args.storage, args.threads)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Annotator: http://{args.host}:{args.port}/?annotate=1', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        Handler.annotator.executor.shutdown(wait=False)


if __name__ == '__main__':
    main()
