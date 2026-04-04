import re

def main():
    with open('knowlage_extracted.txt', 'r', encoding='utf-8') as f:
        content = f.read()
        
    blocks = content.split('--- FILE: ')
    summary = "# PDF Summaries\n\n"
    
    for block in blocks[1:]:
        lines = [line.strip() for line in block.split('\n') if line.strip()]
        if not lines: continue
        
        filename = lines[0].replace(' ---', '')
        
        # Try to find a meaningful title in the first 10-15 lines
        title_lines = []
        for line in lines[1:15]:
            if not re.match(r'^\d+$', line) and 'หน้า' not in line and 'เล่ม' not in line and 'ตอนพิเศษ' not in line:
                title_lines.append(line)
        
        title = " ".join(title_lines[:3])
        if len(title) > 150: title = title[:150] + "..."
        
        summary += f"## {filename}\n- **Title/Excerpt**: {title}\n\n"
        
    with open('pdf_summaries.md', 'w', encoding='utf-8') as f:
        f.write(summary)
        
if __name__ == '__main__':
    main()
