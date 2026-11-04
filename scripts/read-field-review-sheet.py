"""Read saved review edits without modifying either workbook or the CRM."""
from collections import Counter
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from zoneinfo import ZoneInfo
import json
import posixpath
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'BizBase fields and values review.xlsx'
BASELINE = ROOT / 'outputs/01a149a2-a276-7840-91f9-e3b69ba1165e/BizBase fields and values review.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def read_workbook(path):
    result = {}
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in item.findall('.//m:t', NS))
                       for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        relationships = {r.attrib['Id']: r.attrib['Target']
                         for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).find('m:sheets', NS):
            target = relationships[sheet.attrib[REL]]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            rows = []
            for row in ET.fromstring(archive.read(target)).findall('.//m:sheetData/m:row', NS):
                cells = {}
                for cell in row.findall('m:c', NS):
                    value = cell.find('m:v', NS)
                    text = value.text if value is not None else ''
                    if cell.attrib.get('t') == 's':
                        text = strings[int(text)]
                    elif cell.attrib.get('t') == 'inlineStr':
                        text = ''.join(t.text or '' for t in cell.findall('.//m:t', NS))
                    if text:
                        cells[''.join(c for c in cell.attrib['r'] if c.isalpha())] = text
                if int(row.attrib['r']) >= 7 and cells:
                    rows.append({'row': int(row.attrib['r']), 'values': cells})
            result[sheet.attrib['name']] = rows
    return result


def row_key(sheet, row):
    v = row['values']
    return (v.get('H', ''), v.get('I', ''), v.get('C', '')) if sheet == 'Field values' else (v.get('L', ''), v.get('M', ''))


def index_rows(sheet, rows):
    result = {}
    for row in rows:
        key = row_key(sheet, row)
        if key in result:
            raise ValueError(f'Duplicate row key in {sheet}: {key}')
        result[key] = row
    return result


def main():
    updated, baseline = read_workbook(SOURCE), read_workbook(BASELINE)
    changes = []
    for sheet in sorted(set(baseline) | set(updated)):
        before = index_rows(sheet, baseline.get(sheet, []))
        after = index_rows(sheet, updated.get(sheet, []))
        for key in dict.fromkeys([*before, *after]):
            old, new = before.get(key), after.get(key)
            if old is None or new is None:
                changes.append({'sheet': sheet, 'key': list(key), 'type': 'Added row' if old is None else 'Removed row', 'before': old, 'after': new})
                continue
            delta = {col: {'before': old['values'].get(col, ''), 'after': new['values'].get(col, ''), 'cell': f'{col}{new["row"]}'}
                     for col in sorted(set(old['values']) | set(new['values']))
                     if old['values'].get(col, '') != new['values'].get(col, '')}
            if delta:
                changes.append({'sheet': sheet, 'key': list(key), 'type': 'Changed', 'row': new['row'], 'field': new['values'].get('B', ''), 'changes': delta, 'values': new['values']})
    metadata = lambda p: {'path': str(p), 'sha256': sha256(p.read_bytes()).hexdigest(), 'modified': datetime.fromtimestamp(p.stat().st_mtime, ZoneInfo('Europe/Bratislava')).isoformat()}
    result = {
        'reviewDate': '2026-11-04', 'source': metadata(SOURCE), 'baseline': metadata(BASELINE),
        'status': 'Saved sheet edits captured for review; not applied to app/database',
        'precedence': 'Only explicitly changed cells override subsequent conversational decisions/recommendations. Unchanged original-export defaults do not undo later decisions. Remove retires active fields/controls while retaining source and required backend data.',
        'sheetRows': {s: len(rows) for s, rows in updated.items()},
        'changedRowsBySheet': dict(Counter(c['sheet'] for c in changes)),
        'changedCells': sum(len(c.get('changes', {})) for c in changes), 'changes': changes,
    }
    output = ROOT / 'docs/field-sheet-edits-2026-11-04.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ['sheetRows', 'changedRowsBySheet', 'changedCells']}, ensure_ascii=False))
    print('Removed decisions:', sum(c.get('changes', {}).get('G', {}).get('after') == 'Remove' for c in changes))
    for c in changes:
        if 'N' in c.get('changes', {}):
            print(json.dumps({'sheet': c['sheet'], 'row': c['row'], 'field': c['field'], 'note': c['changes']['N']['after']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
