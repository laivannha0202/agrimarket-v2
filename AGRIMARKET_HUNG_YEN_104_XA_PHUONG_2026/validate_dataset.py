#!/usr/bin/env python3
"""Chay: python validate_dataset.py"""
from pathlib import Path
import json,csv,re
root=Path(__file__).resolve().parent
j=json.loads((root/'hung_yen_104_xa_phuong_2026.json').read_text(encoding='utf-8'))
a=j['wards']
with (root/'hung_yen_104_xa_phuong_2026.csv').open(encoding='utf-8-sig',newline='') as f:
    b=list(csv.DictReader(f))
assert j['metadata']['province']['code']=='33'
assert len(a)==len(b)==104
assert sum(r['type']=='xa' for r in a)==93
assert sum(r['type']=='phuong' for r in a)==11
assert len({r['code'] for r in a})==104
assert len({r['fullName'] for r in a})==104
assert all(re.fullmatch(r'\d{5}',r['code']) for r in a)
assert all(r['provinceCode']=='33' and r['provinceName']=='Hưng Yên' for r in a)
assert all(r['fullName']==('Phường ' if r['type']=='phuong' else 'Xã ')+r['name'] for r in a)
assert [{k:r[k] for k in b[0]} for r in a]==b
print('PASS: 104 đơn vị (93 xã, 11 phường); mã unique; tỉnh 33; JSON và CSV khớp.')
