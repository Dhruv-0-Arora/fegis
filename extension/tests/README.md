# PrivacyGuard Benchmarks

This directory contains the core benchmarking suite to ensure that your local detectors and privacy masking logic correctly catches PII while avoiding false positives.

## Available Test Suites

* **`test_cases.json`**: The original 37 edge-cases, obfuscations, and standard PII tests.
* **`dev_test_cases.json`**: Focused 10 test cases dedicated exclusively to mapping API developer keys (Stripe, GitHub, AWS, URL Credentials, Google, RSA Private Keys).

## Running Benchmarks (TypeScript Engine)

Your `extension/` directory now utilizes the merged TypeScript architecture (Remote + Local Best-In-Class Detectors).

To run the unified testing suite:

1. Navigate to the extension folder:
   ```bash
   cd ../extension
   ```
2. Run the TSX benchmark script:
   ```bash
   npx tsx benchmark.ts
   ```

You will see output specifying standard accuracy on your test datasets. (e.g., `Pass count: 32 / 37 (86.5%)` & `10/10 (100%)`). 

## Running Legacy Benchmarks (Python Engine)

If you need to reproduce your initial benchmark scoring comparing NER, Ollama, and the older basic regex models against the remote server:

1. Navigate to your preserved local environment:
   ```bash
   cd ../local/tests
   ```
2. Activate your virtual environment and run the evaluation script:
   ```bash
   python evaluate_my.py
   # Or skip Ollama / NER if you only want to test regex
   python evaluate_my.py --skip-ner --skip-ollama
   ```
 
## Troubleshooting Fails

If you see a `FAIL (FP)` (False Positive) flag in the benchmark output:
* Open `extension/src/detectors/` and identify the specific class returning the error and tweak its regex pattern or context lookback validator.
* Modify mappings within `extension/benchmark.ts` if a tag maps differently than expected (e.g. `[FINANCIAL]` mapping instead of `[CREDIT_CARD]`).
