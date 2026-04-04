import os
import fitz # PyMuPDF
import glob

def main():
    # ใช้ค่าจาก environment variables หรือใช้ค่า default ถ้าไม่มีการระบุ
    pdf_dir = os.getenv("PDF_INPUT_DIR", "knowlage")
    out_file = os.getenv("PDF_OUTPUT_FILE", "knowlage_extracted.txt")
    all_text = []
    
    pdf_files = glob.glob(os.path.join(pdf_dir, "*.pdf"))
    
    for pdf_path in pdf_files:
        filename = os.path.basename(pdf_path)
        try:
            doc = fitz.open(pdf_path)
            text = f"\n\n--- FILE: {filename} ---\n\n"
            for page in doc:
                text += page.get_text()
            all_text.append(text)
            doc.close()
        except Exception as e:
            print(f"Error reading {filename}: {e}")
            
    with open(out_file, "w", encoding="utf-8") as f:
        f.write("".join(all_text))
        
    print(f"Extracted {len(pdf_files)} PDFs to {out_file}")

if __name__ == "__main__":
    main()
