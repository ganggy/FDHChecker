# PDF Input Summary (May 15, 2026)

## Source files processed
- tmp_nhso_eclaim_api.pdf
- temp_ipd_form.pdf

## Extracted text files
- tmp_nhso_eclaim_api.extracted.txt
- temp_ipd_form.extracted.txt

## Key findings

### 1) tmp_nhso_eclaim_api.pdf
This document describes NHSO e-Claim API ingestion (Version 1.0, dated 31/3/2565).

Main points found:
- Auth endpoint:
  - POST https://nhsoapi.nhso.go.th/FMU/ecimp/v1/auth
  - request body: username, password
  - success response includes token
- Send endpoint:
  - POST https://nhsoapi.nhso.go.th/FMU/ecimp/v1/send
  - Authorization: Bearer <token>
  - payload includes:
    - fileType (dbf/txt)
    - maininscl (UCS/OFC/LGO/SSS)
    - dataTypes (IP/OP)
    - opRefer, importDup, assignToMe
    - file sections (ins, pat, opd, etc.) with base64 file content

### 2) temp_ipd_form.pdf
This is a Medical Record Audit Guideline / IPD documentation quality manual.

Main points found:
- Focuses on medical record quality standards and audit criteria
- Includes ICD-10 and ICD-9-CM coding guidance and appendices
- Contains IPD audit form references and documentation requirements

## Relevance to Vale/rules mapping
- No direct debtor/revenue account mapping tables were found in these two PDFs.
- These two files are useful for API integration rules and IPD documentation standards, not direct vale debtor/revenue rule definitions.

## Suggested usage
- Use tmp_nhso_eclaim_api.pdf data for NHSO e-Claim API behavior/endpoint alignment.
- Use temp_ipd_form.pdf for chart/documentation quality workflow, coding policy, and audit references.
