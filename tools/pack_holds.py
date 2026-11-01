#!/usr/bin/env python3
"""Update the packed dataset from detect_holds.py JSON output without manual copying."""
import argparse
import base64
import json
from pathlib import Path
import re
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('input', type=Path)
parser.add_argument('module', type=Path)
args = parser.parse_args()
holds = json.loads(args.input.read_text())['holds']
packed = bytearray()
for hold in holds:
    polygon = hold['polygon']
    assert 3 <= len(polygon) <= 16
    packed.extend((['hold', 'macro', 'volume'].index(hold['kind']), len(polygon)))
    for point in [hold['center'], *polygon]:
        for value in point:
            assert 0 <= value <= 1
            packed.extend(struct.pack('<H', round(value * 65535)))
encoded = base64.b64encode(packed).decode('ascii')
source = args.module.read_text()
source, count = re.subn(r"const PACKED = '[^']*'", lambda _: f"const PACKED = '{encoded}'", source)
assert count == 1
args.module.write_text(source)
print(f'Packed {len(holds)} candidates ({len(packed)} bytes)')
