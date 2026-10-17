const fs = require('fs');

let text = fs.readFileSync('Presences_Figma_AI_Prompt.txt', 'utf8');

text = text.replace(/The UI focuses strictly on operational clarity, spatial depth, real-time biometric telemetry, and campus safety workflows\./g, 'Focus strictly on clarity, spatial depth, biometric telemetry, and safety.');
text = text.replace(/This material mimics Apple pro-display nano-texture etching, scattering reflections into a velvety diffusion while eliminating harsh glare\./g, 'Mimics Apple nano-texture glass, scattering reflections into a velvety diffusion without glare.');
text = text.replace(/Primary interactive containers, hero cards, and floating capsules feature liquid surface tension physics\./g, 'Primary containers, hero cards, and floating capsules use liquid surface tension physics.');

fs.writeFileSync('Presences_Figma_AI_Prompt.txt', text, 'utf8');
let words = text.trim().split(/\s+/).length;
console.log('Final Word Count:', words);
