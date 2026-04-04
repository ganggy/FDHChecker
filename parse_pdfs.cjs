const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const dir = path.join(__dirname, 'knowlage');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));

async function main() {
    let allText = '';
    for (const file of files) {
        const dataBuffer = fs.readFileSync(path.join(dir, file));
        try {
            const data = await pdf(dataBuffer);
            allText += `\n\n--- FILE: ${file} ---\n\n`;
            allText += data.text;
        } catch (e) {
            console.error('Error parsing: ', file, e.message);
        }
    }
    fs.writeFileSync(path.join(__dirname, 'knowlage_extracted.txt'), allText);
    console.log('Extraction complete. Saved to knowlage_extracted.txt');
}
main();
