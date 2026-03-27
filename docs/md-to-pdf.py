#!/usr/bin/env python3
"""Converte Markdown para HTML e depois para PDF."""

import markdown
from xhtml2pdf import pisa

md_path = r'c:\Users\105404\Documents\GitHub\livebridge\docs\Comparativo-Pos-Processamento-Video.md'
html_path = r'c:\Users\105404\Documents\GitHub\livebridge\docs\Comparativo-Pos-Processamento-Video.html'
pdf_path = r'c:\Users\105404\Documents\GitHub\livebridge\docs\Comparativo-Pos-Processamento-Video.pdf'

with open(md_path, 'r', encoding='utf-8') as f:
    md_content = f.read()

html_body = markdown.markdown(md_content, extensions=['tables', 'fenced_code', 'codehilite'])

html_full = f'''<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Comparativo Pós-Processamento de Vídeo</title>
<style>
body {{ font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 900px; margin: 0 auto; padding: 24px; }}
h1 {{ color: #003366; font-size: 24px; border-bottom: 2px solid #003366; padding-bottom: 8px; }}
h2 {{ color: #004c99; font-size: 18px; margin-top: 28px; }}
h3 {{ color: #0066cc; font-size: 15px; margin-top: 18px; }}
table {{ border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 13px; }}
th, td {{ border: 1px solid #ccc; padding: 8px 12px; text-align: left; }}
th {{ background: #e8eef5; font-weight: bold; }}
pre {{ background: #f5f5f5; padding: 12px; overflow-x: auto; font-size: 11px; border-radius: 4px; }}
code {{ background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 12px; }}
ul {{ margin: 10px 0; padding-left: 24px; }}
li {{ margin: 6px 0; }}
hr {{ border: none; border-top: 1px solid #ddd; margin: 24px 0; }}
@media print {{ body {{ margin: 1.5cm; }} }}
</style>
</head>
<body>
{html_body}
</body>
</html>'''

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html_full)

with open(pdf_path, 'wb') as pdf_file:
    pisa_status = pisa.CreatePDF(html_full.encode('utf-8'), dest=pdf_file, encoding='utf-8')

if pisa_status.err:
    print(f'Erro PDF: {pisa_status.err}')
else:
    print(f'HTML: {html_path}')
    print(f'PDF: {pdf_path}')
