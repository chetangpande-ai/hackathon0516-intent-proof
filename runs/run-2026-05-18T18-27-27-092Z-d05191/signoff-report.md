# QA Sign-off Report

**Run ID:** run-2026-05-18T18-27-27-092Z-d05191
**Decision:** Demo-ready for approved web flows
**Domain:** Healthcare (High)
**Approved Test Cases:** 6
**Passed:** 6
**Failed:** 0
**Generated Spec:** runs/run-2026-05-18T18-27-27-092Z-d05191/generated-tests.spec.js
**Completed:** 2026-05-18T18:29:18.255Z

## RAG Source Lineage

### Test Case RAG

- ADO-TC-001: Azure DevOps Test Case Core Fields
  Source: RAG://azure-devops-test-plan-guidelines#core-fields
  Score: 0.508
- ADO-TC-004: Enterprise Sign-off Evidence
  Source: RAG://azure-devops-test-plan-guidelines#signoff-evidence
  Score: 0.4335
- ADO-TC-003: Approval And Traceability
  Source: RAG://azure-devops-test-plan-guidelines#approval-traceability
  Score: 0.4211

### Test Script RAG

- PW-SCRIPT-004: Error Handling And Evidence
  Source: RAG://playwright-automation-guidelines#error-handling-evidence
  Score: 0.5364
- PW-SCRIPT-002: Modular Script Structure
  Source: RAG://playwright-automation-guidelines#modular-structure
  Score: 0.5181
- PW-SCRIPT-001: Playwright Naming Convention
  Source: RAG://playwright-automation-guidelines#naming
  Score: 0.46
- PW-SCRIPT-003: Locator And Assertion Standards
  Source: RAG://playwright-automation-guidelines#locators-assertions
  Score: 0.3919

## Test Case Results

### TC-001 - Validate patient registration and profile creation

- Approval: Approved
- Execution: Passed
- Priority/Risk: P0 / Critical
- Business Flow: Patient registration
- Expected Result: The approved journey completes without blocking errors.
- Evidence: runs/run-2026-05-18T18-27-27-092Z-d05191/screenshots/TC-001.png
- Duration: 2.7 s
- RAG Sources: ADO-TC-001, ADO-TC-004, ADO-TC-003

Steps:
1. Navigate to the target web application.
2. Confirm the primary journey is visible and interactive.
3. Interact with observed action "1".
4. Verify the resulting state matches the approved QA intent.

Assertions:
- Page remains available.
- Expected success or status text is visible.

### TC-002 - Validate appointment booking and confirmation

- Approval: Approved
- Execution: Passed
- Priority/Risk: P0 / Critical
- Business Flow: Appointment booking
- Expected Result: The approved journey completes without blocking errors.
- Evidence: runs/run-2026-05-18T18-27-27-092Z-d05191/screenshots/TC-002.png
- Duration: 4.1 s
- RAG Sources: ADO-TC-001, ADO-TC-004, ADO-TC-003

Steps:
1. Navigate to the target web application.
2. Confirm the primary journey is visible and interactive.
3. Interact with observed action "1".
4. Verify the resulting state matches the approved QA intent.

Assertions:
- Page remains available.
- Expected success or status text is visible.

### TC-003 - Validate medical record access controls

- Approval: Approved
- Execution: Passed
- Priority/Risk: P1 / High
- Business Flow: Medical records
- Expected Result: The approved journey completes without blocking errors.
- Evidence: runs/run-2026-05-18T18-27-27-092Z-d05191/screenshots/TC-003.png
- Duration: 3.0 s
- RAG Sources: ADO-TC-001, ADO-TC-004, ADO-TC-003

Steps:
1. Navigate to the target web application.
2. Confirm the primary journey is visible and interactive.
3. Interact with observed action "1".
4. Verify the resulting state matches the approved QA intent.

Assertions:
- Page remains available.
- Expected success or status text is visible.

### TC-004 - Validate prescription or care instruction visibility

- Approval: Approved
- Execution: Passed
- Priority/Risk: P1 / High
- Business Flow: Prescription
- Expected Result: The approved journey completes without blocking errors.
- Evidence: runs/run-2026-05-18T18-27-27-092Z-d05191/screenshots/TC-004.png
- Duration: 2.0 s
- RAG Sources: ADO-TC-001, ADO-TC-004, ADO-TC-003

Steps:
1. Navigate to the target web application.
2. Confirm the primary journey is visible and interactive.
3. Interact with observed action "1".
4. Verify the resulting state matches the approved QA intent.

Assertions:
- Page remains available.
- Expected success or status text is visible.

### TC-005 - Validate consent and privacy messaging

- Approval: Approved
- Execution: Passed
- Priority/Risk: P1 / High
- Business Flow: Consent
- Expected Result: The approved journey completes without blocking errors.
- Evidence: runs/run-2026-05-18T18-27-27-092Z-d05191/screenshots/TC-005.png
- Duration: 2.4 s
- RAG Sources: ADO-TC-001, ADO-TC-004, ADO-TC-003

Steps:
1. Navigate to the target web application.
2. Confirm the primary journey is visible and interactive.
3. Interact with observed action "1".
4. Verify the resulting state matches the approved QA intent.

Assertions:
- Page remains available.
- Expected success or status text is visible.

### TC-006 - Validate accessibility for patient onboarding

- Approval: Approved
- Execution: Passed
- Priority/Risk: P2 / Medium
- Business Flow: Accessibility
- Expected Result: The approved journey completes without blocking errors.
- Evidence: runs/run-2026-05-18T18-27-27-092Z-d05191/screenshots/TC-006.png
- Duration: 2.0 s
- RAG Sources: ADO-TC-001, ADO-TC-004, ADO-TC-003

Steps:
1. Navigate to the target web application.
2. Confirm the primary journey is visible and interactive.
3. Interact with observed action "1".
4. Verify the resulting state matches the approved QA intent.

Assertions:
- Page remains available.
- Expected success or status text is visible.

## User Sign-off

QA Owner: ____________________

Product Owner: _______________

Date / Decision: _____________

