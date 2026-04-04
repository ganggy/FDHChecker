const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const inputDir = path.join(__dirname, 'knowlage');
const outputDir = path.join(__dirname, 'knowlage', 'extracted');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function processPDFs() {
    const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    console.log(`Found ${files.length} PDFs to process.`);

    for (const file of files) {
        process.stdout.write(`Extracting ${file}... `);
        try {
            const dataBuffer = fs.readFileSync(path.join(inputDir, file));
            const data = await pdf(dataBuffer);
            const textContent = data.text;

            const outPath = path.join(outputDir, file.replace('.pdf', '') + '.txt');
            fs.writeFileSync(outPath, textContent);
            console.log('Done.');
        } catch (err) {
            console.log(`Error: ${err.message}`);
        }
    }
    console.log('Extraction complete. Text files saved to knowlage/extracted/');
}

processPDFs();
