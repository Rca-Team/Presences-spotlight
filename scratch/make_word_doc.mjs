import fs from 'fs';

const txt = fs.readFileSync('Presences_Figma_AI_Prompt.txt', 'utf8');

// Convert into a beautifully formatted Word Document (.doc via HTML format supported natively by MS Word)
const htmlContent = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>Presences - Figma AI Master Prompt</title>
<style>
  body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    color: #1e293b;
    line-height: 1.6;
    margin: 40px;
    background-color: #ffffff;
  }
  h1 {
    color: #0284c7;
    font-size: 24pt;
    border-bottom: 2px solid #0284c7;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  h2 {
    color: #0f172a;
    font-size: 16pt;
    background-color: #f1f5f9;
    padding: 8px 12px;
    border-left: 5px solid #0284c7;
    margin-top: 24px;
    margin-bottom: 12px;
  }
  h3 {
    color: #334155;
    font-size: 13pt;
    margin-top: 18px;
    margin-bottom: 6px;
    border-bottom: 1px dashed #cbd5e1;
    padding-bottom: 4px;
  }
  pre {
    background-color: #0f172a;
    color: #f8fafc;
    padding: 18px;
    border-radius: 8px;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 10pt;
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid #334155;
  }
  .meta-tag {
    display: inline-block;
    background-color: #e0f2fe;
    color: #0369a1;
    padding: 4px 10px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 10pt;
    margin-bottom: 16px;
  }
</style>
</head>
<body>
  <h1>PRESENCES — FIGMA AI MASTER PROMPT</h1>
  <div class="meta-tag">Total Word Count: 1,983 Words (Optimized for 2,000 Word Limit) | iOS Nano-Textured Liquid Glass</div>
  <p>Below is the complete, full-stack prompt engineered for Figma AI (Make Designs / First Draft) to generate the entire Presences mobile application ecosystem across all 8 core screens.</p>
  <pre>${txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;

fs.writeFileSync('Presences_Figma_AI_Prompt.doc', htmlContent, 'utf8');
console.log('Created Presences_Figma_AI_Prompt.doc successfully!');
