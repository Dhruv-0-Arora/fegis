import { analyzeText } from './src/detectors/engine.ts';
import fs from 'fs';

const testFiles = ['./tests/test_cases.json', './tests/dev_test_cases.json'];

for (const testCasesFile of testFiles) {
  const testCases = JSON.parse(fs.readFileSync(testCasesFile, 'utf-8'));

  const scores = [];
  let passCount = 0;
  let msStart = performance.now();

  for (const tc of testCases) {
    const input = tc.input;
    const matches = analyzeText(input, null, []);
    
    const foundSet = new Set(matches.map(m => {
      if (m.type === 'SSN') return '[SSN]';
      if (m.type === 'PHONE') return '[PHONE]';
      if (m.type === 'EMAIL') return '[EMAIL]';
      if (m.type === 'FINANCIAL') return '[FINANCIAL]'; // includes CC, crypto
      if (m.type === 'SECRET') return '[API_KEY]'; // includes API keys
      if (m.type === 'ID') return '[ID_NUMBER]'; // includes UUID, VIN, Passport
      if (m.type === 'NAME') return '[NAME]';
      if (m.type === 'ADDRESS') return '[ADDRESS]';
      if (m.type === 'URL') return '[URL]';
      if (m.type === 'DATE') return '[DATE_OF_BIRTH]';
      if (m.type === 'PATH') return '[PATH]';
      return `[${m.type}]`;
    }));

    const found = Array.from(foundSet);
    
    let expectedMap = new Set(tc.expected_output_contains.map(e => {
      // Map our expectations to remote's generalized types if needed
      if (e === '[CREDIT_CARD]') return '[FINANCIAL]';
      if (e === '[ROUTING_NUM]') return '[FINANCIAL]';
      if (e === '[PASSPORT]') return '[ID_NUMBER]';
      if (e === '[ZIP_CODE]') return '[ADDRESS]';
      if (e === '[API_KEY]') return '[API_KEY]';
      if (e === '[IP_ADDRESS]') return '[API_KEY]'; // their Network detector puts IP here
      return e;
    }));
    const expectedArray = Array.from(expectedMap);
    
    let falsePositive = tc.expected_output_contains.length === 0 && found.length > 0;
    let misses = expectedArray.filter(e => !foundSet.has(e)).length;
    let passed = misses === 0 && !falsePositive;
    if (passed) passCount++;
    
    scores.push({
      id: tc.id,
      passed,
      misses,
      fps: falsePositive ? true : false,
      expected: expectedArray,
      found,
    });
  }

  const msEnd = performance.now();
  let totalTests = scores.length;
  console.log(`\n=== REMOTE TYPESCRIPT DETECTOR: ${testCasesFile} ===`);
  console.log(`Pass count: ${passCount} / ${totalTests} (${((passCount/totalTests)*100).toFixed(1)}%)`);
  console.log(`Time taken: ${(msEnd - msStart).toFixed(2)}ms\n`);

  console.log(`Failed cases:`);
  scores.filter(s => !s.passed).forEach(s => {
    console.log(`- ${s.id} | Expected: ${s.expected} | Found: ${s.found} | FP: ${s.fps}`);
  });
}
