#!/usr/bin/env python3
"""Converte HTML para PDF usando xhtml2pdf"""

from xhtml2pdf import pisa

html_path = r'c:\Users\105404\Documents\GitHub\livebridge\docs\PosiLive-Arquitetura-Streaming.html'
pdf_path = r'c:\Users\105404\Documents\GitHub\livebridge\docs\PosiLive-Arquitetura-Streaming.pdf'

with open(html_path, 'r', encoding='utf-8') as html_file:
    html_content = html_file.read()

with open(pdf_path, 'wb') as pdf_file:
    pisa_status = pisa.CreatePDF(html_content.encode('utf-8'), dest=pdf_file, encoding='utf-8')

if pisa_status.err:
    print(f'Erro: {pisa_status.err}')
else:
    print(f'PDF gerado: {pdf_path}')
