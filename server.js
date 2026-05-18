const express = require('express');
require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const crypto = require('crypto');
const { getRagStatus, retrieveGuidelines } = require('./rag');

const app = express();
const port = Number(process.env.PORT || 4173);
const rootDir = __dirname;
const runsDir = path.join(rootDir, 'runs');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(rootDir, 'public')));
app.use('/runs', express.static(runsDir));

app.get('/demo-fintech', (_req, res) => {
  res.sendFile(path.join(rootDir, 'public', 'demo-fintech.html'));
});

app.post('/api/intents', async (req, res) => {
  try {
    const { url, intent } = req.body || {};
    if (!url || !intent) {
      return res.status(400).json({ error: 'URL and intent are required.' });
    }

    const runId = createRunId();
    const runDir = await ensureRunDir(runId);
    const fallback = buildFallbackIntents(url, intent);
    const generated = await generateWithLLM({
      purpose: 'qa-intents',
      prompt: buildIntentPrompt(url, intent),
      fallback,
      validate: value => Array.isArray(value?.intents) && value.intents.length > 0
    });

    const intents = normalizeIntents(generated.intents || fallback.intents);
    const domain = normalizeDomain(generated.domain || fallback.domain, url, intent);
    const payload = {
      runId,
      url,
      source: generated.source,
      domain,
      intents,
      reasoningTrace: [
        `Domain Agent detected ${domain.name} with ${domain.confidence} confidence.`,
        `Signals: ${domain.signals.join(', ') || 'URL and release intent'}.`,
        `Risk Intent Agent generated ${intents.length} ${domain.name.toLowerCase()}-aware QA intents.`,
        generated.source === 'llm' ? 'Used live LLM generation with deterministic schema cleanup.' : 'Used deterministic fallback templates so the demo remains stable.'
      ]
    };

    await writeJson(path.join(runDir, 'intent-input.json'), { url, intent });
    await writeJson(path.join(runDir, 'generated-intents.json'), payload);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/observe', async (req, res) => {
  let browser;
  try {
    const { url, approvedIntents = [], runId: providedRunId } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'URL is required.' });
    }

    const runId = providedRunId || createRunId();
    const runDir = await ensureRunDir(runId);
    const screenshotDir = path.join(runDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);

    const observation = await page.evaluate(() => {
      const text = value => (value || '').replace(/\s+/g, ' ').trim();
      const controlSummary = element => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || '',
        text: text(element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('name')),
        testId: element.getAttribute('data-testid') || '',
        name: element.getAttribute('name') || '',
        placeholder: element.getAttribute('placeholder') || '',
        role: element.getAttribute('role') || ''
      });

      return {
        title: document.title,
        url: location.href,
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 12).map(node => text(node.innerText)),
        buttons: Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"]')).slice(0, 30).map(controlSummary),
        inputs: Array.from(document.querySelectorAll('input,select,textarea')).slice(0, 30).map(controlSummary),
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(link => ({
          text: text(link.innerText || link.getAttribute('aria-label')),
          href: link.href
        })),
        forms: Array.from(document.querySelectorAll('form')).slice(0, 10).map(form => ({
          testId: form.getAttribute('data-testid') || '',
          labels: Array.from(form.querySelectorAll('label')).map(label => text(label.innerText)).filter(Boolean)
        })),
        visibleTextSample: text(document.body.innerText).slice(0, 1200)
      };
    });

    const screenshotPath = path.join(screenshotDir, 'observe.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const rawScriptPath = path.join(runDir, 'raw-crawl.spec.js');
    await fs.writeFile(rawScriptPath, buildRawCrawlScript(url, observation.title), 'utf8');

    const payload = {
      runId,
      observation,
      screenshotPath: toPublicRunPath(screenshotPath),
      rawScriptPath: toRelativePath(rawScriptPath),
      reasoningTrace: [
        `Opened ${url} with Playwright and captured the loaded page state.`,
        `Observed ${observation.forms.length} forms, ${observation.inputs.length} inputs, ${observation.buttons.length} buttons, and ${observation.links.length} links.`,
        `Mapped observation to ${approvedIntents.length} human-approved QA intents before test generation.`
      ]
    };

    await writeJson(path.join(runDir, 'observation.json'), payload);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: enrichPlaywrightError(error) });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
});

app.post('/api/test-cases', async (req, res) => {
  try {
    const { runId, approvedIntents = [], observation = {} } = req.body || {};
    if (!runId) {
      return res.status(400).json({ error: 'runId is required.' });
    }
    if (!approvedIntents.length) {
      return res.status(400).json({ error: 'At least one approved intent is required.' });
    }

    const runDir = await ensureRunDir(runId);
    const ragContext = retrieveGuidelines({
      type: 'test-case',
      topK: 3,
      query: `Azure DevOps Test Plans enterprise test case format ${approvedIntents.map(item => `${item.title} ${item.flow} ${item.releaseGate}`).join(' ')}`
    });
    const lineage = buildLineage('test-case', ragContext);
    const fallback = buildFallbackTestCases(approvedIntents, observation);
    const generated = await generateWithLLM({
      purpose: 'test-cases',
      prompt: buildTestCasePrompt(approvedIntents, observation, ragContext),
      fallback,
      validate: value => Array.isArray(value?.testCases) && value.testCases.length > 0
    });

    const testCases = normalizeTestCases(generated.testCases || fallback.testCases, approvedIntents, lineage);
    const payload = {
      runId,
      source: generated.source,
      ragStatus: getRagStatus(),
      sourceLineage: lineage,
      testCases,
      reasoningTrace: [
        `Converted ${approvedIntents.length} approved intents into ${testCases.length} enterprise test cases.`,
        `Applied ${ragContext.length} FAISS-retrieved Azure DevOps test-case guidelines.`,
        'Included preconditions, test data, executable steps, expected results, assertions, risk, and reviewer status.',
        'Kept test cases pending until a human explicitly approves them for automation.'
      ]
    };

    await writeJson(path.join(runDir, 'generated-test-cases.json'), payload);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scripts', async (req, res) => {
  try {
    const { runId, url, approvedTestCases = [] } = req.body || {};
    if (!runId || !url) {
      return res.status(400).json({ error: 'runId and URL are required.' });
    }
    if (!approvedTestCases.length) {
      return res.status(400).json({ error: 'At least one approved test case is required before script generation.' });
    }

    const runDir = await ensureRunDir(runId);
    const screenshotDir = path.join(runDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    const approvedTestCasesPath = path.join(runDir, 'approved-test-cases.json');
    await writeJson(approvedTestCasesPath, { runId, approvedTestCases });

    const ragContext = retrieveGuidelines({
      type: 'test-script',
      topK: 4,
      query: `Playwright modular scripting naming convention error handling method signatures ${approvedTestCases.map(item => `${item.id} ${item.title} ${item.businessFlow}`).join(' ')}`
    });
    const lineage = buildLineage('test-script', ragContext);
    const specPath = path.join(runDir, 'generated-tests.spec.js');
    const specSource = buildGeneratedSpec({ url, approvedTestCases, runDir, ragContext });
    await fs.writeFile(specPath, specSource, 'utf8');

    const scriptReview = {
      runId,
      status: 'pending-run-approval',
      approvedTestCount: approvedTestCases.length,
      ragStatus: getRagStatus(),
      sourceLineage: lineage,
      generatedSpecPath: toRelativePath(specPath),
      approvedTestCasesPath: toRelativePath(approvedTestCasesPath),
      scriptPreview: specSource.split('\n').slice(0, 42).join('\n'),
      generatedAt: new Date().toISOString()
    };
    const scriptReviewPath = path.join(runDir, 'script-review.json');
    await writeJson(scriptReviewPath, scriptReview);

    res.json({
      ...scriptReview,
      scriptReviewPath: toRelativePath(scriptReviewPath),
      reasoningTrace: [
        `Converted ${approvedTestCases.length} human-approved test cases into a Playwright spec.`,
        `Applied ${ragContext.length} FAISS-retrieved automation guidelines for modular scripting and evidence handling.`,
        'Kept execution blocked until a human explicitly approves and runs the generated script.',
        'Stored generated automation and approved test-case evidence in the run workspace.'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/execute', async (req, res) => {
  try {
    const { runId, url, approvedTestCases = [], generatedSpecPath } = req.body || {};
    if (!runId) {
      return res.status(400).json({ error: 'runId is required.' });
    }

    const runDir = await ensureRunDir(runId);
    let specPath = path.join(runDir, 'generated-tests.spec.js');
    let executionTestCases = approvedTestCases;

    if (generatedSpecPath) {
      const candidate = path.resolve(rootDir, generatedSpecPath);
      if (!candidate.startsWith(path.resolve(runDir))) {
        return res.status(400).json({ error: 'generatedSpecPath must stay inside the active run folder.' });
      }
      specPath = candidate;
    }

    if (!existsSync(specPath)) {
      if (!url || !approvedTestCases.length) {
        return res.status(400).json({ error: 'Generate scripts first, or provide URL and approved test cases.' });
      }
      await fs.writeFile(specPath, buildGeneratedSpec({ url, approvedTestCases, runDir }), 'utf8');
    }

    if (!executionTestCases.length) {
      const approvedPath = path.join(runDir, 'approved-test-cases.json');
      if (existsSync(approvedPath)) {
        const saved = JSON.parse(await fs.readFile(approvedPath, 'utf8'));
        executionTestCases = saved.approvedTestCases || [];
      }
    }

    if (!executionTestCases.length) {
      return res.status(400).json({ error: 'No approved test cases found for execution.' });
    }

    const outputDir = path.join(runDir, 'test-results');
    const jsonReportPath = path.join(runDir, 'playwright-report.json');
    const result = await runPlaywrightSpec(specPath, outputDir);
    let report = null;
    if (result.stdout) {
      report = parseJsonReport(result.stdout);
      if (report) {
        await writeJson(jsonReportPath, report);
      }
    }

    const passed = result.exitCode === 0;
    const summary = buildReleaseSummary({ passed, approvedTestCases: executionTestCases, result, report });
    const generatedTestCasesPath = path.join(runDir, 'generated-test-cases.json');
    const generatedTestCases = existsSync(generatedTestCasesPath)
      ? JSON.parse(await fs.readFile(generatedTestCasesPath, 'utf8'))
      : {};
    const scriptReviewPath = path.join(runDir, 'script-review.json');
    const scriptReview = existsSync(scriptReviewPath)
      ? JSON.parse(await fs.readFile(scriptReviewPath, 'utf8'))
      : {};
    const sourceLineage = {
      testCases: generatedTestCases.sourceLineage || null,
      testScripts: scriptReview.sourceLineage || null
    };
    let evidence = {
      runId,
      status: passed ? 'passed' : 'failed',
      approvedCount: executionTestCases.length,
      generatedSpecPath: toRelativePath(specPath),
      approvedTestCasesPath: toRelativePath(path.join(runDir, 'approved-test-cases.json')),
      reportPath: report ? toRelativePath(jsonReportPath) : null,
      outputDir: toRelativePath(outputDir),
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
      releaseSummary: summary,
      sourceLineage,
      completedAt: new Date().toISOString()
    };

    const signoffReport = await buildSignoffReportArtifacts({
      runId,
      runDir,
      evidence,
      approvedTestCases: executionTestCases,
      report,
      summary,
      specPath
    });
    evidence = {
      ...evidence,
      testCaseResults: signoffReport.testCaseResults,
      signoffReportHtmlPath: signoffReport.htmlPath,
      signoffReportMarkdownPath: signoffReport.markdownPath
    };

    const evidencePath = path.join(runDir, 'evidence.json');
    await writeJson(evidencePath, evidence);
    res.json({
      ...evidence,
      evidencePath: toRelativePath(evidencePath),
      reasoningTrace: [
        `Ran human-approved Playwright automation for ${executionTestCases.length} approved test cases.`,
        `Captured ${passed ? 'passing' : 'failing'} execution evidence from the approved script.`,
        passed ? 'Release-readiness signal improved for approved web flows.' : 'Release-readiness remains blocked until failed checks are triaged.'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: enrichPlaywrightError(error) });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'IntentProof', time: new Date().toISOString() });
});

app.get('/api/rag/status', (_req, res) => {
  res.json(getRagStatus());
});

app.listen(port, async () => {
  await fs.mkdir(runsDir, { recursive: true });
  console.log(`IntentProof running at http://localhost:${port}`);
  console.log(`Bundled fintech demo app: http://localhost:${port}/demo-fintech`);
});

function createRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
}

async function ensureRunDir(runId) {
  const runDir = path.join(runsDir, runId);
  await fs.mkdir(runDir, { recursive: true });
  return runDir;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toRelativePath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function toPublicRunPath(filePath) {
  return `/${toRelativePath(filePath)}`;
}

function buildLineage(kind, ragContext = []) {
  return {
    kind,
    backend: 'faiss-node',
    index: 'IndexFlatIP',
    sourceFile: 'rag/guidelines.json',
    retrievedAt: new Date().toISOString(),
    chunkCount: ragContext.length,
    chunks: ragContext.map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      section: item.section,
      source: item.source,
      score: item.score,
      excerpt: item.text
    }))
  };
}

function lineageIdsFrom(sourceLineage = {}) {
  if (Array.isArray(sourceLineage)) {
    return sourceLineage.map(item => String(item)).filter(Boolean);
  }
  return (sourceLineage.chunks || []).map(item => item.id).filter(Boolean);
}

function buildFallbackIntents(url, intent) {
  const domain = detectDomain(url, intent);
  const packs = {
    Healthcare: [
      intentItem('INT-P0-001', 'Validate patient registration and profile creation', 'P0', 'Critical', 'Patient registration', 'Patient identity and demographics must be captured correctly before clinical workflows can proceed.', ['Patient can submit required demographic details.', 'Profile is created without exposing sensitive health data.'], 'Functional'),
      intentItem('INT-P0-002', 'Validate appointment booking and confirmation', 'P0', 'Critical', 'Appointment booking', 'Appointment scheduling is the core healthcare access flow and a release blocker.', ['Patient can select provider, date, and slot.', 'Appointment confirmation is shown with correct details.'], 'Functional'),
      intentItem('INT-P1-003', 'Validate medical record access controls', 'P1', 'High', 'Medical records', 'Protected health information needs clear access boundaries and audit-friendly behavior.', ['Authorized user can view records.', 'Unauthorized or missing context does not expose records.'], 'Security/Privacy'),
      intentItem('INT-P1-004', 'Validate prescription or care instruction visibility', 'P1', 'High', 'Prescription', 'Medication and care instructions have direct patient-safety impact.', ['Prescription details are visible after the correct workflow.', 'Instructions are readable and tied to the right patient.'], 'Functional'),
      intentItem('INT-P1-005', 'Validate consent and privacy messaging', 'P1', 'High', 'Consent', 'Consent and privacy clarity are key governance controls in healthcare apps.', ['Consent language is presented before sensitive action.', 'User can accept or decline with clear status.'], 'Compliance'),
      intentItem('INT-P2-006', 'Validate accessibility for patient onboarding', 'P2', 'Medium', 'Accessibility', 'Healthcare journeys must be usable by patients with varied accessibility needs.', ['Critical fields have labels.', 'Primary journey supports keyboard focus.'], 'Accessibility')
    ],
    'E-commerce': [
      intentItem('INT-P0-001', 'Validate product discovery and product detail view', 'P0', 'High', 'Product discovery', 'Users must find products and inspect details before checkout.', ['Product list is reachable.', 'Product detail includes price and availability.'], 'Functional'),
      intentItem('INT-P0-002', 'Validate cart add, update, and remove behavior', 'P0', 'Critical', 'Cart', 'Cart integrity directly affects order value and customer trust.', ['Item can be added to cart.', 'Quantity and remove actions update totals correctly.'], 'Functional'),
      intentItem('INT-P0-003', 'Validate checkout and order confirmation', 'P0', 'Critical', 'Checkout', 'Checkout is the highest-value revenue flow.', ['Customer can complete checkout with valid data.', 'Order confirmation is displayed.'], 'Functional'),
      intentItem('INT-P1-004', 'Validate failed payment or validation handling', 'P1', 'High', 'Payment resiliency', 'Failed checkout needs safe recovery without duplicate orders.', ['Invalid payment data is rejected.', 'No duplicate order is created.'], 'Functional'),
      intentItem('INT-P1-005', 'Validate order history or status visibility', 'P1', 'High', 'Order tracking', 'Customers need order evidence after purchase.', ['Order appears in history.', 'Status is visible and understandable.'], 'Regression')
    ],
    Fintech: [
      intentItem('INT-P0-001', 'Validate account creation and session entry', 'P0', 'High', 'Account creation', 'A release demo fails immediately if a new customer cannot create an account and enter the product.', ['Customer can submit valid profile details.', 'Customer lands in the onboarding journey without validation errors.'], 'Functional'),
      intentItem('INT-P0-002', 'Validate KYC onboarding state progression', 'P0', 'Critical', 'KYC onboarding', 'KYC is a fintech identity gate and a common release blocker for onboarding flows.', ['Valid identity details are accepted.', 'KYC status moves to review or approved state with clear messaging.'], 'Functional'),
      intentItem('INT-P0-003', 'Validate payment success and wallet balance update', 'P0', 'Critical', 'Payment and wallet', 'Money movement and balance accuracy have the highest customer and compliance impact.', ['Payment can be submitted successfully.', 'Wallet balance reflects the payment amount exactly once.'], 'Functional'),
      intentItem('INT-P1-004', 'Validate failed or duplicate payment handling', 'P1', 'Critical', 'Payment resiliency', 'Duplicate or ambiguous payment states can create financial loss and reconciliation issues.', ['Invalid payment input is rejected safely.', 'Duplicate submission is prevented or clearly handled.'], 'Functional'),
      intentItem('INT-P1-005', 'Validate refund initiation and status visibility', 'P1', 'High', 'Refund', 'Refund errors damage trust and are often tied to legacy regression risk.', ['Eligible transaction can trigger refund.', 'Refund status is visible after submission.'], 'Regression'),
      intentItem('INT-P1-006', 'Validate fraud decision visibility in payment flow', 'P1', 'High', 'Fraud check', 'Fraud decisions should be visible in shadow/demo mode without blocking good users unexpectedly.', ['Fraud risk is calculated before payment completion.', 'The decision is explainable to the operator or user.'], 'AI Model Safety')
    ],
    Generic: [
      intentItem('INT-P0-001', 'Validate primary user onboarding flow', 'P0', 'High', 'Onboarding', 'Users must be able to enter the product and reach the main journey.', ['Required fields can be completed.', 'User reaches the next valid product state.'], 'Functional'),
      intentItem('INT-P0-002', 'Validate core business transaction or submission', 'P0', 'Critical', 'Core workflow', 'The primary business action is the main release-readiness signal.', ['Core action can be submitted.', 'Success or status state is visible.'], 'Functional'),
      intentItem('INT-P1-003', 'Validate validation and error recovery', 'P1', 'High', 'Negative path', 'Release demos often fail when validation and recovery paths are unclear.', ['Invalid input is rejected clearly.', 'User can recover without page failure.'], 'Functional'),
      intentItem('INT-P1-004', 'Validate notification or confirmation evidence', 'P1', 'Medium', 'Confirmation', 'Users need evidence that important actions completed.', ['Confirmation is visible.', 'Status or timeline reflects the completed action.'], 'Regression'),
      intentItem('INT-P2-005', 'Validate accessibility smoke coverage', 'P2', 'Medium', 'Accessibility', 'Basic accessibility gaps are common in late-stage releases.', ['Critical fields have labels.', 'Focus order is usable.'], 'Accessibility')
    ]
  };

  return { domain, intents: packs[domain.name] || packs.Generic };
}

function intentItem(id, title, priority, riskLevel, flow, rationale, acceptanceCriteria, releaseGate) {
  return {
    id,
    title,
    priority,
    riskLevel,
    flow,
    rationale,
    acceptanceCriteria,
    suggestedAutomation: releaseGate === 'Accessibility' ? 'web-a11y' : 'web',
    releaseGate
  };
}

function normalizeIntents(intents) {
  return intents.slice(0, 10).map((intent, index) => ({
    id: intent.id || `INT-${String(index + 1).padStart(3, '0')}`,
    title: intent.title || intent.intent || `QA intent ${index + 1}`,
    priority: normalizePriority(intent.priority),
    riskLevel: intent.riskLevel || intent.risk || 'High',
    flow: intent.flow || 'Web flow',
    rationale: intent.rationale || intent.reason || 'Selected because it contributes to release confidence.',
    acceptanceCriteria: Array.isArray(intent.acceptanceCriteria) ? intent.acceptanceCriteria : ['Expected behavior is visible and verifiable.'],
    suggestedAutomation: intent.suggestedAutomation || 'web',
    releaseGate: intent.releaseGate || 'Functional',
    reviewerStatus: 'pending'
  }));
}

function detectDomain(url, intent) {
  const haystack = `${url} ${intent}`.toLowerCase();
  const candidates = [
    {
      name: 'Healthcare',
      keywords: ['health', 'healthcare', 'hospital', 'clinic', 'patient', 'doctor', 'appointment', 'medical', 'medicine', 'prescription', 'ehr', 'emr', 'lab', 'insurance', 'hipaa']
    },
    {
      name: 'Fintech',
      keywords: ['fintech', 'bank', 'banking', 'payment', 'wallet', 'kyc', 'loan', 'credit', 'debit', 'refund', 'fraud', 'transaction', 'account balance', 'upi', 'pci']
    },
    {
      name: 'E-commerce',
      keywords: ['shop', 'cart', 'checkout', 'order', 'product', 'catalog', 'shipping', 'coupon', 'inventory', 'ecommerce', 'commerce']
    },
    {
      name: 'Education',
      keywords: ['student', 'course', 'learning', 'exam', 'quiz', 'classroom', 'assignment', 'lms', 'school', 'university']
    },
    {
      name: 'Travel',
      keywords: ['travel', 'flight', 'hotel', 'booking', 'reservation', 'itinerary', 'check-in', 'checkin', 'trip']
    }
  ];

  const scored = candidates.map(candidate => ({
    ...candidate,
    signals: candidate.keywords.filter(keyword => haystack.includes(keyword))
  })).sort((a, b) => b.signals.length - a.signals.length);

  const winner = scored[0];
  if (!winner || winner.signals.length === 0) {
    return {
      name: 'Generic',
      confidence: 'Medium',
      signals: ['release intent', 'target URL'],
      rationale: 'No strong industry keywords were found, so the agent used a generic web release-readiness model.'
    };
  }

  return {
    name: winner.name,
    confidence: winner.signals.length >= 3 ? 'High' : 'Medium',
    signals: winner.signals.slice(0, 5),
    rationale: `Detected ${winner.name.toLowerCase()} signals from the target URL and release intent.`
  };
}

function normalizeDomain(domain, url, intent) {
  const fallback = detectDomain(url, intent);
  if (!domain || typeof domain !== 'object') {
    return fallback;
  }
  return {
    name: domain.name || domain.domain || fallback.name,
    confidence: domain.confidence || fallback.confidence,
    signals: Array.isArray(domain.signals) && domain.signals.length ? domain.signals.slice(0, 6) : fallback.signals,
    rationale: domain.rationale || domain.reason || fallback.rationale
  };
}

function buildFallbackTestCases(approvedIntents, observation) {
  const cases = approvedIntents.map((intent, index) => ({
    id: `TC-${String(index + 1).padStart(3, '0')}`,
    title: intent.title,
    businessIntentId: intent.id,
    businessFlow: intent.flow,
    priority: normalizePriority(intent.priority),
    riskLevel: intent.riskLevel || 'High',
    preconditions: [
      'Target web application is reachable.',
      'QA user has valid demo test data.',
      'No production money movement is used during execution.'
    ],
    testData: buildTestDataForIntent(intent),
    steps: buildStepsForIntent(intent, observation),
    expectedResult: buildExpectedResultForIntent(intent),
    assertions: buildAssertionsForIntent(intent),
    automationStatus: 'generated',
    reviewerStatus: 'pending',
    evidenceLink: null,
    rationale: intent.rationale || 'Validates a release-critical web flow.'
  }));

  return { testCases: cases };
}

function normalizeTestCases(testCases, approvedIntents, sourceLineage = {}) {
  const defaultSourceIds = lineageIdsFrom(sourceLineage);
  return testCases.slice(0, 12).map((testCase, index) => {
    const linkedIntent = approvedIntents.find(intent => intent.id === testCase.businessIntentId) || approvedIntents[index] || {};
    return {
      id: testCase.id || `TC-${String(index + 1).padStart(3, '0')}`,
      title: testCase.title || linkedIntent.title || `Generated test case ${index + 1}`,
      businessIntentId: testCase.businessIntentId || linkedIntent.id || '',
      businessFlow: testCase.businessFlow || linkedIntent.flow || 'Web flow',
      priority: normalizePriority(testCase.priority || linkedIntent.priority),
      riskLevel: testCase.riskLevel || linkedIntent.riskLevel || 'High',
      preconditions: asArray(testCase.preconditions, ['Target web application is reachable.']),
      testData: testCase.testData || buildTestDataForIntent(linkedIntent),
      steps: asArray(testCase.steps, buildStepsForIntent(linkedIntent, {})),
      expectedResult: testCase.expectedResult || buildExpectedResultForIntent(linkedIntent),
      assertions: asArray(testCase.assertions, buildAssertionsForIntent(linkedIntent)),
      automationStatus: testCase.automationStatus || 'generated',
      reviewerStatus: 'pending',
      evidenceLink: testCase.evidenceLink || null,
      rationale: testCase.rationale || linkedIntent.rationale || 'Generated from approved QA intent.',
      sourceLineage: asArray(testCase.sourceLineage, defaultSourceIds)
    };
  });
}

function normalizePriority(priority) {
  if (['P0', 'P1', 'P2'].includes(String(priority).toUpperCase())) {
    return String(priority).toUpperCase();
  }
  return 'P1';
}

function asArray(value, fallback) {
  if (Array.isArray(value) && value.length) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return fallback;
}

function buildTestDataForIntent(intent = {}) {
  const title = `${intent.title || ''} ${intent.flow || ''}`.toLowerCase();
  if (title.includes('payment') || title.includes('wallet')) {
    return { amount: '2500', payee: 'Acme Supplies', expectedBalance: '12500' };
  }
  if (title.includes('kyc')) {
    return { pan: 'ABCDE1234F', identityId: 'KYC-2026-001', status: 'Under review' };
  }
  if (title.includes('refund')) {
    return { refundReason: 'Duplicate charge', expectedStatus: 'Refund initiated' };
  }
  return { fullName: 'Asha Mehta', email: 'asha.qa@example.com', phone: '9876543210' };
}

function buildStepsForIntent(intent = {}, observation = {}) {
  const title = `${intent.title || ''} ${intent.flow || ''}`.toLowerCase();
  const base = [
    'Navigate to the target web application.',
    'Confirm the primary journey is visible and interactive.'
  ];
  if (title.includes('account')) {
    return [
      ...base,
      'Enter valid customer profile details.',
      'Submit account creation.',
      'Verify the KYC onboarding step becomes available.'
    ];
  }
  if (title.includes('kyc')) {
    return [
      ...base,
      'Complete the account creation step if required.',
      'Enter valid KYC identity data.',
      'Submit KYC details.',
      'Verify the KYC status moves forward with clear messaging.'
    ];
  }
  if (title.includes('payment') || title.includes('wallet')) {
    return [
      ...base,
      'Complete account and KYC prerequisites if required.',
      'Enter payment amount and payee.',
      'Run fraud/risk check.',
      'Submit payment.',
      'Verify wallet balance and transaction status update.'
    ];
  }
  if (title.includes('refund')) {
    return [
      ...base,
      'Complete a successful payment prerequisite if required.',
      'Trigger refund for the latest eligible transaction.',
      'Verify refund status and wallet timeline update.'
    ];
  }
  if (title.includes('notification')) {
    return [
      ...base,
      'Complete a critical event such as payment or refund.',
      'Verify notification timeline includes the event.'
    ];
  }
  if (observation?.buttons?.length) {
    return [
      ...base,
      `Interact with observed action "${observation.buttons[0].text || observation.buttons[0].testId || 'primary button'}".`,
      'Verify the resulting state matches the approved QA intent.'
    ];
  }
  return [...base, 'Execute the approved business scenario.', 'Verify the expected result is visible.'];
}

function buildExpectedResultForIntent(intent = {}) {
  const title = `${intent.title || ''} ${intent.flow || ''}`.toLowerCase();
  if (title.includes('wallet')) {
    return 'Payment completes once and wallet balance reflects the expected amount.';
  }
  if (title.includes('kyc')) {
    return 'KYC details are accepted and the user sees a clear review or approval state.';
  }
  if (title.includes('refund')) {
    return 'Refund can be initiated and the status is visible to the user.';
  }
  if (title.includes('notification')) {
    return 'Relevant notification appears after the critical event.';
  }
  return 'The approved journey completes without blocking errors.';
}

function buildAssertionsForIntent(intent = {}) {
  const title = `${intent.title || ''} ${intent.flow || ''}`.toLowerCase();
  if (title.includes('payment') || title.includes('wallet')) {
    return ['Payment status is successful.', 'Wallet balance is updated.', 'No duplicate payment confirmation appears.'];
  }
  if (title.includes('kyc')) {
    return ['KYC status message is visible.', 'Identity form is not left in an error state.'];
  }
  if (title.includes('refund')) {
    return ['Refund status is visible.', 'Refund notification is visible.'];
  }
  return ['Page remains available.', 'Expected success or status text is visible.'];
}

async function generateWithLLM({ purpose, prompt, fallback, validate }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ...fallback, source: 'fallback' };
  }

  const modelName = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  console.log(`LLM triggered: purpose=${purpose}, model=${modelName}`);
  console.log(`LLM prompt: ${prompt.length > 2000 ? prompt.slice(0, 2000) + '...[truncated]' : prompt}`);

  try {
    const response = await fetch('https://api.groq.ai/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,

        input: [
          {
            role: 'system',
            content: 'You are a senior QA architect. Return strict JSON only. Do not wrap JSON in markdown.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2
      })
    });

    console.log(`LLM HTTP status: ${response.status}`);
    const data = await response.json();
    console.log('LLM raw response:', JSON.stringify(data, null, 2));
    const text = data.output_text || extractResponsesText(data);
    console.log(`LLM extracted text: ${text.length > 2000 ? text.slice(0, 2000) + '...[truncated]' : text}`);
    const parsed = JSON.parse(text);
    if (!validate(parsed)) {
      return { ...fallback, source: `fallback (${purpose}: invalid LLM schema)` };
    }
    return { ...parsed, source: 'llm' };
  } catch (_error) {
    return { ...fallback, source: `fallback (${purpose}: LLM unavailable)` };
  }
}

function extractResponsesText(data) {
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n');
}

function buildIntentPrompt(url, intent) {
  return `
Act as a multi-agent QA orchestrator.
First, run a Domain Recognition Agent.
Then, run a Risk Intent Agent that creates domain-specific enterprise QA intents.

Target URL: ${url}
Rough business intent: ${intent}

Generate only the right number of intents for the detected domain and stated scope.
Use 4 to 7 intents for normal scope. Do not always return 8.
If the URL or intent is healthcare-related, generate healthcare intents such as patient registration, appointment booking, medical records, prescription/care instructions, consent/privacy, insurance, and accessibility.
If fintech-related, generate fintech intents such as account creation, KYC, payment, wallet, refund, fraud, and notification.
If e-commerce-related, generate product, cart, checkout, payment, order, and fulfillment intents.

Return JSON with this shape:
{
  "domain": {
    "name": "Healthcare|Fintech|E-commerce|Education|Travel|Generic",
    "confidence": "High|Medium|Low",
    "signals": ["keyword or URL clue"],
    "rationale": "why this domain was selected"
  },
  "intents": [
    {
      "id": "INT-P0-001",
      "title": "...",
      "priority": "P0|P1|P2",
      "riskLevel": "Critical|High|Medium",
      "flow": "...",
      "rationale": "...",
      "acceptanceCriteria": ["..."],
      "suggestedAutomation": "web",
      "releaseGate": "Functional|Regression|Accessibility|AI Model Safety"
    }
  ]
}
Prioritize the highest release-risk flows for the detected domain. Avoid unrelated fintech flows unless the detected domain is fintech.
`;
}

function buildTestCasePrompt(approvedIntents, observation, ragContext = []) {
  return `
Create enterprise-standard executable web test cases from approved QA intents and Playwright observation.

Use these FAISS-retrieved RAG guidelines as the source of truth for test case structure and governance:
${JSON.stringify(ragContext.map(item => ({
  id: item.id,
  title: item.title,
  source: item.source,
  text: item.text
})), null, 2)}

Approved intents:
${JSON.stringify(approvedIntents, null, 2)}

Observation:
${JSON.stringify(observation, null, 2).slice(0, 5000)}

Return JSON:
{
  "testCases": [
    {
      "id": "TC-001",
      "title": "...",
      "businessIntentId": "...",
      "businessFlow": "...",
      "priority": "P0|P1|P2",
      "riskLevel": "Critical|High|Medium",
      "preconditions": ["..."],
      "testData": {"key":"value"},
      "steps": ["..."],
      "expectedResult": "...",
      "assertions": ["..."],
      "automationStatus": "generated",
      "reviewerStatus": "pending",
      "evidenceLink": null,
      "rationale": "...",
      "sourceLineage": ["RAG chunk ids used, such as ADO-TC-001"]
    }
  ]
}
`;
}

function buildRawCrawlScript(url, title) {
  return `const { test, expect } = require('@playwright/test');

test('raw observed crawl for release-readiness agent', async ({ page }) => {
  await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(${title ? new RegExp(escapeRegExp(title.slice(0, 24)), 'i').toString() : '/.+/'});
  await page.screenshot({ path: 'raw-crawl-observe.png', fullPage: true });
});
`;
}

function buildGeneratedSpec({ url, approvedTestCases, runDir, ragContext = [] }) {
  const isDemo = url.includes('/demo-fintech');
  const ragComment = ragContext.length
    ? ragContext.map(item => `// RAG ${item.id}: ${item.title} (${item.source})`).join('\n')
    : '// RAG: No script guideline context attached.';
  const tests = approvedTestCases.map(testCase => {
    const title = `${testCase.id} ${testCase.title}`.replace(/'/g, '');
    if (isDemo) {
      return `
test(${JSON.stringify(title)}, async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await completeFintechJourney(page);
  await expect(page.getByTestId('release-status')).toContainText(/Demo ready|Refund initiated|Payment complete/);
  await page.screenshot({ path: path.join(screenshotDir, ${JSON.stringify(`${testCase.id}.png`)}), fullPage: true });
});`;
    }

    return `
test(${JSON.stringify(title)}, async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await page.screenshot({ path: path.join(screenshotDir, ${JSON.stringify(`${testCase.id}.png`)}), fullPage: true });
});`;
  }).join('\n');

  return `${ragComment}
const { test, expect } = require('@playwright/test');
const path = require('path');

const targetUrl = ${JSON.stringify(url)};
const screenshotDir = ${JSON.stringify(path.join(runDir, 'screenshots'))};

${tests}

async function completeFintechJourney(page) {
  await expect(page.getByRole('heading', { name: /fintrust/i })).toBeVisible();
  await page.getByTestId('full-name').fill('Asha Mehta');
  await page.getByTestId('email').fill('asha.qa@example.com');
  await page.getByTestId('phone').fill('9876543210');
  await page.getByTestId('account-continue').click();
  await expect(page.getByTestId('kyc-panel')).toBeVisible();

  await page.getByTestId('pan').fill('ABCDE1234F');
  await page.getByTestId('identity-id').fill('KYC-2026-001');
  await page.getByTestId('kyc-continue').click();
  await expect(page.getByTestId('payment-panel')).toBeVisible();

  await page.getByTestId('amount').fill('2500');
  await page.getByTestId('payee').fill('Acme Supplies');
  await page.getByTestId('fraud-check').click();
  await expect(page.getByTestId('fraud-status')).toContainText(/Low risk/);
  await page.getByTestId('payment-submit').click();
  await expect(page.getByTestId('wallet-balance')).toContainText('12,500');
  await expect(page.getByTestId('payment-status')).toContainText(/Payment complete/);

  await page.getByTestId('refund-button').click();
  await expect(page.getByTestId('refund-status')).toContainText(/Refund initiated/);
  await expect(page.getByTestId('notification-list')).toContainText(/Refund initiated/);
}
`;
}

function runPlaywrightSpec(specPath, outputDir) {
  return new Promise(resolve => {
    const playwrightCli = path.join(rootDir, 'node_modules', 'playwright', 'cli.js');
    const specArg = toRelativePath(specPath);
    const command = existsSync(playwrightCli) ? process.execPath : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
    const args = existsSync(playwrightCli)
      ? [playwrightCli, 'test', specArg, '--reporter=json', `--output=${outputDir}`]
      : ['playwright', 'test', specArg, '--reporter=json', `--output=${outputDir}`];

    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, CI: '1' },
      shell: false
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('close', exitCode => {
      resolve({ exitCode, stdout, stderr });
    });
    child.on('error', error => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });
}

function parseJsonReport(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (_error) {
    const firstBrace = stdout.indexOf('{');
    const lastBrace = stdout.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
      } catch (_inner) {
        return null;
      }
    }
    return null;
  }
}

function buildReleaseSummary({ passed, approvedTestCases, result, report }) {
  const blockers = passed ? 0 : 1;
  const total = approvedTestCases.length;
  const reportStats = report?.stats;
  return {
    decision: passed ? 'Demo-ready for approved web flows' : 'Not demo-ready until failures are triaged',
    approvedTests: total,
    passedTests: reportStats?.expected ?? (passed ? total : 0),
    failedTests: (reportStats?.unexpected ?? 0) + (reportStats?.flaky ?? 0),
    blockers,
    message: passed
      ? 'Approved critical flows executed successfully with saved evidence.'
      : `Approved test execution failed. Review Playwright stderr/stdout. Exit code: ${result.exitCode}.`
  };
}

async function buildSignoffReportArtifacts({ runId, runDir, evidence, approvedTestCases, report, summary, specPath }) {
  const generatedIntentPath = path.join(runDir, 'generated-intents.json');
  const generatedIntents = existsSync(generatedIntentPath)
    ? JSON.parse(await fs.readFile(generatedIntentPath, 'utf8'))
    : {};
  const scriptReviewPath = path.join(runDir, 'script-review.json');
  const scriptReview = existsSync(scriptReviewPath)
    ? JSON.parse(await fs.readFile(scriptReviewPath, 'utf8'))
    : {};
  const generatedTestCasesPath = path.join(runDir, 'generated-test-cases.json');
  const generatedTestCases = existsSync(generatedTestCasesPath)
    ? JSON.parse(await fs.readFile(generatedTestCasesPath, 'utf8'))
    : {};
  const testCaseResults = mapApprovedTestCaseResults({ approvedTestCases, report, runDir });
  const context = {
    runId,
    targetUrl: generatedIntents.url || '',
    domain: generatedIntents.domain || null,
    source: generatedIntents.source || 'unknown',
    completedAt: evidence.completedAt,
    summary,
    evidence,
    approvedTestCases,
    testCaseResults,
    specPath: toRelativePath(specPath),
    scriptReviewPath: scriptReview.scriptReviewPath || toRelativePath(scriptReviewPath),
    ragStatus: generatedTestCases.ragStatus || scriptReview.ragStatus || null,
    sourceLineage: {
      testCases: generatedTestCases.sourceLineage || null,
      testScripts: scriptReview.sourceLineage || null
    }
  };

  const htmlFile = path.join(runDir, 'signoff-report.html');
  const markdownFile = path.join(runDir, 'signoff-report.md');
  await fs.writeFile(htmlFile, renderSignoffHtml(context), 'utf8');
  await fs.writeFile(markdownFile, renderSignoffMarkdown(context), 'utf8');

  return {
    htmlPath: toRelativePath(htmlFile),
    markdownPath: toRelativePath(markdownFile),
    testCaseResults
  };
}

function mapApprovedTestCaseResults({ approvedTestCases, report, runDir }) {
  const specs = flattenReportSpecs(report);
  const byId = new Map();
  for (const spec of specs) {
    const id = (spec.title || '').match(/TC-\d+/)?.[0];
    if (!id) {
      continue;
    }
    const test = spec.tests?.[0] || {};
    const latestResult = test.results?.[test.results.length - 1] || {};
    const errors = latestResult.errors || [];
    byId.set(id, {
      status: spec.ok && latestResult.status === 'passed' ? 'Passed' : 'Failed',
      durationMs: latestResult.duration || 0,
      error: errors.map(item => item.message || item.stack || String(item)).filter(Boolean).join('\n'),
      startedAt: latestResult.startTime || null
    });
  }

  return approvedTestCases.map(testCase => {
    const result = byId.get(testCase.id) || {
      status: 'Not Run',
      durationMs: 0,
      error: 'No matching Playwright result was found for this approved test case.',
      startedAt: null
    };
    const screenshotPath = path.join(runDir, 'screenshots', `${testCase.id}.png`);
    return {
      id: testCase.id,
      title: testCase.title,
      businessIntentId: testCase.businessIntentId,
      businessFlow: testCase.businessFlow,
      priority: testCase.priority,
      riskLevel: testCase.riskLevel,
      approvalStatus: 'Approved',
      executionStatus: result.status,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      screenshotPath: existsSync(screenshotPath) ? toRelativePath(screenshotPath) : null,
      preconditions: asArray(testCase.preconditions, []),
      testData: testCase.testData || {},
      steps: asArray(testCase.steps, []),
      expectedResult: testCase.expectedResult || '',
      assertions: asArray(testCase.assertions, []),
      sourceLineage: asArray(testCase.sourceLineage, []),
      error: result.error || ''
    };
  });
}

function flattenReportSpecs(report) {
  const specs = [];
  const visit = suite => {
    for (const spec of suite?.specs || []) {
      specs.push(spec);
    }
    for (const child of suite?.suites || []) {
      visit(child);
    }
  };
  for (const suite of report?.suites || []) {
    visit(suite);
  }
  return specs;
}

function renderSignoffHtml(context) {
  const passed = context.summary.failedTests === 0;
  const domain = context.domain?.name ? `${context.domain.name} (${context.domain.confidence || 'Medium'})` : 'Not captured';
  const lineageSection = renderSignoffLineageHtml(context.sourceLineage);
  const rows = context.testCaseResults.map(testCase => `
    <section class="case">
      <div class="case-head">
        <div>
          <p class="eyebrow">${escapeHtmlReport(testCase.id)} | ${escapeHtmlReport(testCase.businessFlow || 'Business flow')}</p>
          <h2>${escapeHtmlReport(testCase.title)}</h2>
        </div>
        <div class="badges">
          <span class="badge approved">Approved</span>
          <span class="badge ${testCase.executionStatus === 'Passed' ? 'passed' : 'failed'}">${escapeHtmlReport(testCase.executionStatus)}</span>
          <span class="badge neutral">${escapeHtmlReport(testCase.priority)} | ${escapeHtmlReport(testCase.riskLevel)}</span>
        </div>
      </div>
      <div class="case-grid">
        <div>
          <h3>Expected Result</h3>
          <p>${escapeHtmlReport(testCase.expectedResult)}</p>
        </div>
        <div>
          <h3>Evidence</h3>
          <p>${testCase.screenshotPath ? `<a href="/${escapeHtmlReport(testCase.screenshotPath)}">${escapeHtmlReport(testCase.screenshotPath)}</a>` : 'No screenshot captured'}</p>
          <p>Duration: ${escapeHtmlReport(formatDuration(testCase.durationMs))}</p>
        </div>
      </div>
      <h3>Steps</h3>
      <ol>${testCase.steps.map(step => `<li>${escapeHtmlReport(step)}</li>`).join('')}</ol>
      <h3>Assertions</h3>
      <ul>${testCase.assertions.map(assertion => `<li>${escapeHtmlReport(assertion)}</li>`).join('')}</ul>
      ${testCase.sourceLineage?.length ? `<h3>RAG Sources Used</h3><p class="source-ids">${testCase.sourceLineage.map(item => `<code>${escapeHtmlReport(item)}</code>`).join(' ')}</p>` : ''}
      ${testCase.error ? `<h3>Failure Detail</h3><pre>${escapeHtmlReport(testCase.error)}</pre>` : ''}
    </section>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>QA Sign-off Report - ${escapeHtmlReport(context.runId)}</title>
    <style>
      body { margin: 0; background: #f5f7fa; color: #172033; font-family: Arial, sans-serif; }
      main { max-width: 1120px; margin: 0 auto; padding: 28px; }
      .report-header, .summary, .case, .signoff, .lineage { background: #fff; border: 1px solid #d9e0ea; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
      h1, h2, h3, p { margin-top: 0; }
      h1 { font-size: 30px; margin-bottom: 8px; }
      h2 { font-size: 20px; margin-bottom: 4px; }
      h3 { font-size: 13px; text-transform: uppercase; color: #647084; margin-bottom: 8px; }
      .eyebrow { color: #087f8c; font-size: 12px; font-weight: 800; text-transform: uppercase; margin-bottom: 6px; }
      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
      .tile { border: 1px solid #d9e0ea; border-radius: 8px; padding: 12px; background: #fbfcfe; }
      .tile span { display: block; color: #647084; font-size: 12px; font-weight: 800; text-transform: uppercase; margin-bottom: 6px; }
      .tile strong { display: block; overflow-wrap: anywhere; }
      .decision { background: ${passed ? '#e8f7ef' : '#fff0ed'}; border-color: ${passed ? '#a6dfc0' : '#ffcdc5'}; }
      .decision strong { color: ${passed ? '#167a50' : '#b42318'}; }
      .case-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 1px solid #d9e0ea; padding-bottom: 12px; margin-bottom: 12px; }
      .badges { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
      .badge { border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; border: 1px solid #d9e0ea; white-space: nowrap; }
      .approved, .passed { color: #167a50; background: #e8f7ef; border-color: #a6dfc0; }
      .failed { color: #b42318; background: #fff0ed; border-color: #ffcdc5; }
      .neutral { color: #9a5b00; background: #fff5df; border-color: #ffd98d; }
      .case-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .lineage-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .lineage-card { border: 1px solid #d9e0ea; border-radius: 8px; padding: 12px; background: #fbfcfe; }
      .lineage-card code, .source-ids code { display: inline-block; margin: 3px 4px 3px 0; padding: 3px 6px; border-radius: 999px; background: #e8f0ff; color: #1f63d6; font-weight: 800; }
      .lineage-card p { color: #647084; line-height: 1.45; margin-bottom: 8px; }
      li { margin: 6px 0; line-height: 1.45; }
      pre { white-space: pre-wrap; background: #111827; color: #eef2ff; padding: 12px; border-radius: 8px; }
      .signoff-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .line { border-bottom: 1px solid #647084; min-height: 36px; }
      @media (max-width: 860px) { .summary, .case-grid, .signoff-grid, .lineage-grid { grid-template-columns: 1fr; } .case-head { display: block; } .badges { justify-content: flex-start; } }
    </style>
  </head>
  <body>
    <main>
      <section class="report-header">
        <p class="eyebrow">QA sign-off report</p>
        <h1>${escapeHtmlReport(context.summary.decision)}</h1>
        <p>${escapeHtmlReport(context.summary.message)}</p>
      </section>
      <section class="summary">
        <div class="tile"><span>Run ID</span><strong>${escapeHtmlReport(context.runId)}</strong></div>
        <div class="tile"><span>Domain</span><strong>${escapeHtmlReport(domain)}</strong></div>
        <div class="tile"><span>Approved test cases</span><strong>${context.approvedTestCases.length}</strong></div>
        <div class="tile decision"><span>Decision</span><strong>${escapeHtmlReport(context.summary.decision)}</strong></div>
        <div class="tile"><span>Passed</span><strong>${context.summary.passedTests}</strong></div>
        <div class="tile"><span>Failed</span><strong>${context.summary.failedTests}</strong></div>
        <div class="tile"><span>Generated spec</span><strong>${escapeHtmlReport(context.specPath)}</strong></div>
        <div class="tile"><span>Completed</span><strong>${escapeHtmlReport(context.completedAt)}</strong></div>
      </section>
      ${lineageSection}
      ${rows}
      <section class="signoff">
        <p class="eyebrow">User sign-off</p>
        <h2>Approval</h2>
        <div class="signoff-grid">
          <div><h3>QA Owner</h3><div class="line"></div></div>
          <div><h3>Product Owner</h3><div class="line"></div></div>
          <div><h3>Date / Decision</h3><div class="line"></div></div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderSignoffLineageHtml(sourceLineage = {}) {
  const groups = [
    ['Test Case RAG', sourceLineage.testCases],
    ['Test Script RAG', sourceLineage.testScripts]
  ].filter(([, lineage]) => lineage?.chunks?.length);

  if (!groups.length) {
    return '';
  }

  const cards = groups.map(([label, lineage]) => lineage.chunks.map(chunk => `
    <div class="lineage-card">
      <h3>${escapeHtmlReport(label)}</h3>
      <code>${escapeHtmlReport(chunk.id)}</code>
      <p><strong>${escapeHtmlReport(chunk.title)}</strong></p>
      <p>${escapeHtmlReport(chunk.excerpt)}</p>
      <p>Source: ${escapeHtmlReport(chunk.source)} | Score: ${escapeHtmlReport(chunk.score)}</p>
    </div>
  `).join('')).join('');

  return `
      <section class="lineage">
        <p class="eyebrow">RAG source lineage</p>
        <h2>Guidelines Used To Generate Output</h2>
        <div class="lineage-grid">${cards}</div>
      </section>`;
}

function renderSignoffMarkdown(context) {
  const domain = context.domain?.name ? `${context.domain.name} (${context.domain.confidence || 'Medium'})` : 'Not captured';
  const lines = [
    `# QA Sign-off Report`,
    '',
    `**Run ID:** ${context.runId}`,
    `**Decision:** ${context.summary.decision}`,
    `**Domain:** ${domain}`,
    `**Approved Test Cases:** ${context.approvedTestCases.length}`,
    `**Passed:** ${context.summary.passedTests}`,
    `**Failed:** ${context.summary.failedTests}`,
    `**Generated Spec:** ${context.specPath}`,
    `**Completed:** ${context.completedAt}`,
    '',
    `## RAG Source Lineage`,
    ''
  ];

  appendLineageMarkdown(lines, 'Test Case RAG', context.sourceLineage?.testCases);
  appendLineageMarkdown(lines, 'Test Script RAG', context.sourceLineage?.testScripts);

  lines.push(
    `## Test Case Results`,
    ''
  );

  for (const testCase of context.testCaseResults) {
    lines.push(`### ${testCase.id} - ${testCase.title}`);
    lines.push('');
    lines.push(`- Approval: Approved`);
    lines.push(`- Execution: ${testCase.executionStatus}`);
    lines.push(`- Priority/Risk: ${testCase.priority} / ${testCase.riskLevel}`);
    lines.push(`- Business Flow: ${testCase.businessFlow || 'N/A'}`);
    lines.push(`- Expected Result: ${testCase.expectedResult}`);
    lines.push(`- Evidence: ${testCase.screenshotPath || 'No screenshot captured'}`);
    lines.push(`- Duration: ${formatDuration(testCase.durationMs)}`);
    lines.push(`- RAG Sources: ${testCase.sourceLineage?.length ? testCase.sourceLineage.join(', ') : 'N/A'}`);
    lines.push('');
    lines.push(`Steps:`);
    testCase.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push('');
    lines.push(`Assertions:`);
    testCase.assertions.forEach(assertion => lines.push(`- ${assertion}`));
    if (testCase.error) {
      lines.push('');
      lines.push(`Failure Detail:`);
      lines.push('```text');
      lines.push(testCase.error);
      lines.push('```');
    }
    lines.push('');
  }

  lines.push(`## User Sign-off`);
  lines.push('');
  lines.push(`QA Owner: ____________________`);
  lines.push('');
  lines.push(`Product Owner: _______________`);
  lines.push('');
  lines.push(`Date / Decision: _____________`);
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function appendLineageMarkdown(lines, label, lineage) {
  if (!lineage?.chunks?.length) {
    lines.push(`- ${label}: No RAG chunks captured.`);
    lines.push('');
    return;
  }

  lines.push(`### ${label}`);
  lines.push('');
  for (const chunk of lineage.chunks) {
    lines.push(`- ${chunk.id}: ${chunk.title}`);
    lines.push(`  Source: ${chunk.source}`);
    lines.push(`  Score: ${chunk.score}`);
  }
  lines.push('');
}

function formatDuration(durationMs = 0) {
  if (!durationMs) {
    return '0 ms';
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function escapeHtmlReport(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function trimOutput(value = '') {
  return value.length > 6000 ? `${value.slice(0, 6000)}\n... trimmed ...` : value;
}

function enrichPlaywrightError(error) {
  const message = error.message || String(error);
  if (message.includes('Executable doesn')) {
    return `${message}\nRun npm run playwright:install to install Chromium.`;
  }
  return message;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
