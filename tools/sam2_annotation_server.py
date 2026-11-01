#!/usr/bin/env python3
"""Serve the full-wall SAM2 annotator and built frontend on a single origin."""
from __future__ import annotations

import argparse
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hmac
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
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
    if not (0 <= value[0] <= 1 and 0 <= value[1] <= 1):
        raise ValueError('Prompts must be inside the full wall.')
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


def clean_hold(hold, identifier=None):
    if not isinstance(hold, dict) or not isinstance(hold.get('polygon'), list) or not 3 <= len(hold['polygon']) <= 16:
        raise ValueError('Each hold requires 3–16 polygon vertices.')
    point(hold.get('center'))
    for vertex in hold['polygon']: point(vertex)
    identifier = identifier or hold.get('id')
    if not isinstance(identifier, str) or not 1 <= len(identifier) <= 100:
        raise ValueError('Each hold needs a stable ID of 1–100 characters.')
    kind = hold.get('kind', 'hold')
    if kind not in ('hold', 'macro', 'volume'): raise ValueError('Invalid hold kind.')
    return dict(id=identifier, kind=kind, center=hold['center'], polygon=hold['polygon'])


def clean_dataset(data):
    if isinstance(data, list): data = dict(holds=data)
    if not isinstance(data, dict) or not isinstance(data.get('holds'), list) or len(data['holds']) > 5000:
        raise ValueError('Import a JSON object containing at most 5000 holds.')
    if data.get('wallId', 'stoneham-spraywall-v1') != 'stoneham-spraywall-v1': raise ValueError('Wrong wall ID.')
    dimensions = data.get('image_size', data.get('metadata', {}).get('image_size', [WIDTH, HEIGHT]))
    if dimensions != [WIDTH, HEIGHT]: raise ValueError('Image dimensions do not match the canonical wall.')
    result = [clean_hold(hold) for hold in data['holds']]
    if len({h['id'] for h in result}) != len(result): raise ValueError('Duplicate IDs in imported file.')
    return result


def prediction_region(prompts, box):
    locations = [p['point'] for p in prompts]
    if box: locations += [box[:2], box[2:]]
    anchor = [p['point'] for p in prompts if p['label'] == 1] or locations
    x = sum(p[0] for p in anchor) / len(anchor) * WIDTH
    y = sum(p[1] for p in anchor) / len(anchor) * HEIGHT
    col, row = min(2, int(x / CROP_WIDTH)), min(2, int(y / CROP_HEIGHT))
    left, top = max(0, col * CROP_WIDTH - 160), max(0, row * CROP_HEIGHT - 160)
    right, bottom = min(WIDTH, (col + 1) * CROP_WIDTH + 160), min(HEIGHT, (row + 1) * CROP_HEIGHT + 160)
    left = max(0, min(left, int(min(p[0] for p in locations) * WIDTH) - 96))
    top = max(0, min(top, int(min(p[1] for p in locations) * HEIGHT) - 96))
    right = min(WIDTH, max(right, int(max(p[0] for p in locations) * WIDTH) + 96))
    bottom = min(HEIGHT, max(bottom, int(max(p[1] for p in locations) * HEIGHT) + 96))
    return left, top, right, bottom


class Annotator:
    def __init__(self, checkpoint: Path, storage: Path, threads: int, seed: Path | None = None):
        self.storage = storage
        self.lock = threading.Lock()
        self.model_lock = threading.Lock()
        self.status = dict(state='loading', model='SAM2.1 Small', device='checking',
                           image_size=[WIDTH, HEIGHT], crop_size=[WIDTH, HEIGHT], inference='overlapping tiles')
        self.model = None
        self.image = None
        self.predictors = OrderedDict()
        self.seed = seed
        if not storage.exists() and seed and seed.exists():
            self.write(dict(holds=clean_dataset(json.loads(seed.read_text()))))
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
            self.image = image
            self.crop_bytes = (ROOT / 'public/wall/stoneham-spraywall-canonical.jpg').read_bytes()
            model = build_sam2(CONFIG, str(checkpoint), device=self.status['device'], apply_postprocessing=False)
            self.model = model
            with torch.inference_mode():
                self.predictor_for((0, 0, CROP_WIDTH + 160, CROP_HEIGHT + 160))
            self.status.update(state='ready')
            print(f'SAM2 ready on {self.status["device"]}; full wall available; tile embeddings cached', flush=True)
        except Exception as error:
            self.status.update(state='error', error=f'{type(error).__name__}: {error}. See docs/sam2-local-annotator.md for setup.')
            print(self.status['error'], flush=True)

    def predictor_for(self, region):
        import numpy as np
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        if region not in self.predictors:
            predictor = SAM2ImagePredictor(self.model)
            predictor.set_image(np.array(self.image.crop(region), copy=True))
            self.predictors[region] = predictor
            if len(self.predictors) > 2: self.predictors.popitem(last=False)
        self.predictors.move_to_end(region)
        return self.predictors[region]

    def predict(self, body):
        import cv2
        import numpy as np
        import torch
        prompts, box = validate_prompts(body)
        left, top, right, bottom = region = prediction_region(prompts, box)
        w, h = right - left, bottom - top
        coords = np.array([[min(w - 1, max(0, p['point'][0] * WIDTH - left)), min(h - 1, max(0, p['point'][1] * HEIGHT - top))] for p in prompts], dtype=np.float32) if prompts else None
        labels = np.array([p['label'] for p in prompts], dtype=np.int32) if prompts else None
        rectangle = np.array([box[0] * WIDTH - left, box[1] * HEIGHT - top, box[2] * WIDTH - left, box[3] * HEIGHT - top], dtype=np.float32) if box else None
        started = time.monotonic()
        with torch.inference_mode():
            predictor = self.predictor_for(region)
            masks, scores, _ = predictor.predict(point_coords=coords, point_labels=labels, box=rectangle, multimask_output=True)
        results = []
        for mask, score in zip(masks, scores):
            count, components, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
            if count < 2: continue
            positives = [p['point'] for p in prompts if p['label'] == 1]
            def rank(label):
                votes = sum(components[min(h - 1, max(0, int(y * HEIGHT - top))), min(w - 1, max(0, int(x * WIDTH - left)))] == label for x, y in positives)
                return votes, stats[label, cv2.CC_STAT_AREA]
            label = max(range(1, count), key=rank)
            component = (components == label).astype(np.uint8)
            contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contour = max(contours, key=cv2.contourArea)
            epsilon = max(.1, cv2.arcLength(contour, True) * .004)
            polygon = cv2.approxPolyDP(contour, epsilon, True)
            while len(polygon) > 16:
                epsilon *= 1.2; polygon = cv2.approxPolyDP(contour, epsilon, True)
            if len(polygon) < 3: continue
            ys, xs = np.nonzero(component)
            results.append(dict(kind='hold', center=[(float(xs.mean()) + left) / WIDTH, (float(ys.mean()) + top) / HEIGHT],
                                polygon=[[(int(x) + left) / WIDTH, (int(y) + top) / HEIGHT] for x, y in polygon[:, 0]], score=float(score)))
        results.sort(key=lambda item: -item['score'])
        return dict(candidates=results, region=list(region), elapsed_seconds=round(time.monotonic() - started, 3))

    def read(self):
        if not self.storage.exists():
            return dict(holds=[])
        data = json.loads(self.storage.read_text())
        if not isinstance(data, dict) or not isinstance(data.get('holds'), list):
            raise RuntimeError('Saved annotation file is invalid; restore it before saving further changes.')
        return data

    def write(self, data):
        data.update(wallId='stoneham-spraywall-v1', image_size=[WIDTH, HEIGHT], crop_box=[0, 0, WIDTH, HEIGHT],
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
        if path == '/api/sam2/suggestions':
            path = ROOT / 'src/data/experiments/full_wall_sam2_suggestions.json'
            return self.json(200, json.loads(path.read_text()) if path.exists() else dict(holds=[]))
        if path in ('/api/sam2/crop.jpg', '/api/sam2/image.jpg'):
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
            if not 0 < size <= 4 * 1024 * 1024:
                raise ValueError('Request body must be between 1 byte and 4 MiB.')
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
                identifier = body.get('id')
                clean = clean_hold(body.get('hold'), identifier or f'manual-{uuid.uuid4().hex[:12]}')
                with self.annotator.lock:
                    data = self.annotator.read()
                    if identifier:
                        match = next((i for i, hold in enumerate(data['holds']) if hold['id'] == identifier), None)
                        if match is None: return self.json(404, dict(error='Original hold is missing; refresh before editing.'))
                        if body.get('original') != data['holds'][match]:
                            return self.json(409, dict(error='This hold changed in another tab. Reload before saving.'))
                        data['holds'][match] = clean
                    else: data['holds'].append(clean)
                    return self.json(200, self.annotator.write(data))
            if path == '/api/sam2/dismiss':
                identifier = body.get('id')
                if not isinstance(identifier, str) or not identifier.startswith('sam2-auto-'):
                    raise ValueError('Choose an automatic suggestion to skip.')
                with self.annotator.lock:
                    data = self.annotator.read()
                    data['dismissed_suggestions'] = sorted(set(data.get('dismissed_suggestions', [])) | {identifier})
                    return self.json(200, self.annotator.write(data))
            if path == '/api/sam2/import':
                imported = clean_dataset(body.get('dataset'))
                with self.annotator.lock:
                    data = self.annotator.read()
                    current = {hold['id']: hold for hold in data['holds']}
                    conflicts = [hold['id'] for hold in imported if hold['id'] in current and hold != current[hold['id']]]
                    if conflicts and body.get('replace_existing') is not True:
                        return self.json(409, dict(error=f'{len(conflicts)} matching IDs differ. Enable Replace matching IDs to overwrite those holds.'))
                    current.update({hold['id']: hold for hold in imported})
                    data['holds'] = list(current.values())
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
    parser.add_argument('--storage', type=Path, default=ROOT / 'artifacts/full-wall-annotations/holds.json')
    parser.add_argument('--seed', type=Path, default=ROOT / 'src/data/polygons/holds.json', help='Initialize empty working storage from this file; never overwrites existing work.')
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
    Handler.annotator = Annotator(args.checkpoint, args.storage, args.threads, args.seed)
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
