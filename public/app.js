const state = {
  runId: null,
  url: '',
  domain: null,
  intents: [],
  observation: null,
  testCases: [],
  scriptReview: null,
  evidence: null,
  user: null
};

const SESSION_KEY = 'riskToTestMockSession';
const authShell = document.querySelector('#auth-shell');
const appShell = document.querySelector('#app-shell');
const userPill = document.querySelector('#user-pill');
const signOutButton = document.querySelector('#sign-out');
const demoSigninButton = document.querySelector('#demo-signin');
const targetUrl = document.querySelector('#target-url');
const businessIntent = document.querySelector('#business-intent');
const runPill = document.querySelector('#run-pill');
const intentCount = document.querySelector('#intent-count');
const testCount = document.querySelector('#test-count');
const executionStatus = document.querySelector('#execution-status');
const decisionHeadline = document.querySelector('#decision-headline');
const nextAction = document.querySelector('#next-action');
const targetMetric = document.querySelector('#target-metric');
const domainMetric = document.querySelector('#domain-metric');
const approvedIntentsMetric = document.querySelector('#approved-intents-metric');
const approvedTestsMetric = document.querySelector('#approved-tests-metric');
const decisionMetric = document.querySelector('#decision-metric');
const activityTimeline = document.querySelector('#activity-timeline');

const generateIntentsButton = document.querySelector('#generate-intents');
const observeButton = document.querySelector('#observe-app');
const generateTestsButton = document.querySelector('#generate-tests');
const generateScriptsButton = document.querySelector('#generate-scripts');
const executeButton = document.querySelector('#execute-tests');

const intentSection = document.querySelector('#intent-section');
const observeSection = document.querySelector('#observe-section');
const testsSection = document.querySelector('#tests-section');
const scriptsSection = document.querySelector('#scripts-section');
const evidenceSection = document.querySelector('#evidence-section');

const intentsList = document.querySelector('#intents-list');
const observationPanel = document.querySelector('#observation-panel');
const testCasesList = document.querySelector('#test-cases-list');
const scriptPanel = document.querySelector('#script-panel');
const evidencePanel = document.querySelector('#evidence-panel');
const VISIBLE_REVIEW_ITEMS = 3;
const targetSuggestions = {
  demo: {
    label: 'Demo fintech',
    url: () => `${window.location.origin}/demo-fintech`,
    intent: 'Validate account creation, KYC onboarding, payment, wallet update, refund readiness, fraud signal visibility, and notification evidence'
  },
  hdfc: {
    label: 'HDFC home loan',
    url: () => 'https://www.hdfc.com/housing-loans/home-loans',
    intent: 'Validate home loan discovery, eligibility calculator, application start, document readiness, callback lead capture, and disclosure visibility'
  },
  practo: {
    label: 'Practo',
    url: () => 'https://www.practo.com/doctors',
    intent: 'Validate doctor search, specialty discovery, appointment booking entry, patient contact capture, clinic visibility, and trust indicators'
  },
  apollo: {
    label: 'Apollo 24|7',
    url: () => 'https://www.apollo247.com/',
    intent: 'Validate patient onboarding, doctor consultation discovery, medicine search, lab test booking entry, account access, and care journey readiness'
  },
  irctc: {
    label: 'IRCTC',
    url: () => 'https://www.irctc.co.in/nget/train-search',
    intent: 'Validate train search, source and destination selection, journey date entry, availability discovery, login handoff, and booking readiness'
  }
};

targetUrl.value = targetSuggestions.demo.url();
businessIntent.value = targetSuggestions.demo.intent;
targetMetric.textContent = summarizeTarget(targetUrl.value);
switchTab('intent');
restoreSession();

document.querySelectorAll('.sso-button').forEach(button => {
  button.addEventListener('click', () => signIn(button.dataset.provider || 'Mock SSO'));
});
demoSigninButton.addEventListener('click', () => signIn('Demo QA Lead'));
signOutButton.addEventListener('click', signOut);
document.querySelectorAll('.suggestion-chip').forEach(button => {
  button.addEventListener('click', () => applyTargetSuggestion(button.dataset.targetKey));
});
generateIntentsButton.addEventListener('click', generateIntents);
observeButton.addEventListener('click', observeApp);
generateTestsButton.addEventListener('click', generateTestCases);
generateScriptsButton.addEventListener('click', generateScripts);
executeButton.addEventListener('click', executeTests);
document.querySelectorAll('.step[data-tab]').forEach(tabButton => {
  tabButton.addEventListener('click', () => switchTab(tabButton.dataset.tab));
});

function restoreSession() {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (!saved) {
    showAuth();
    return;
  }

  try {
    state.user = JSON.parse(saved);
    showApp();
  } catch (_error) {
    sessionStorage.removeItem(SESSION_KEY);
    showAuth();
  }
}

function signIn(provider) {
  state.user = {
    name: 'Asha QA Lead',
    provider,
    role: 'Release QA Lead',
    signedInAt: new Date().toISOString()
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.user));
  showApp();
}

function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  state.user = null;
  showAuth();
}

function showAuth() {
  authShell.classList.remove('is-hidden');
  appShell.classList.add('is-hidden');
  document.body.classList.add('auth-active');
}

function showApp() {
  authShell.classList.add('is-hidden');
  appShell.classList.remove('is-hidden');
  document.body.classList.remove('auth-active');
  const provider = state.user?.provider || 'Mock SSO';
  userPill.textContent = `${state.user?.name || 'QA Lead'} | ${provider}`;
  switchTab('intent');
}

function applyTargetSuggestion(key) {
  const suggestion = targetSuggestions[key];
  if (!suggestion) {
    return;
  }
  targetUrl.value = suggestion.url();
  businessIntent.value = suggestion.intent;
  document.querySelectorAll('.suggestion-chip').forEach(button => {
    button.classList.toggle('active', button.dataset.targetKey === key);
  });
  resetAfterIntent();
  switchTab('intent');
}

function syncTargetSuggestionState() {
  const currentUrl = targetUrl.value.trim();
  let matched = false;
  document.querySelectorAll('.suggestion-chip').forEach(button => {
    const suggestion = targetSuggestions[button.dataset.targetKey];
    const isActive = suggestion?.url() === currentUrl;
    button.classList.toggle('active', isActive);
    matched = matched || isActive;
  });
  return matched;
}

async function generateIntents() {
  setBusy(generateIntentsButton, true, 'Generating...');
  resetAfterIntent();
  try {
    const payload = await postJson('/api/intents', {
      url: targetUrl.value.trim(),
      intent: businessIntent.value.trim()
    });
    state.runId = payload.runId;
    state.url = payload.url;
    state.domain = payload.domain;
    state.intents = payload.intents;
    runPill.textContent = state.runId;
    renderIntents(payload.reasoningTrace);
    activateStep(1);
    updateCommandCenter('intent', 'Approve the P0 intents you want the agent to observe.');
    switchTab('intent');
    scrollToSection(intentSection);
  } catch (error) {
    renderError(intentsList, error);
    updateCommandCenter('intent', 'Intent generation needs attention before the run can continue.');
  } finally {
    setBusy(generateIntentsButton, false, 'Generate QA Intents');
  }
}

async function observeApp() {
  const approvedIntents = collectApprovedIntents();
  if (!approvedIntents.length) {
    renderError(observationPanel, new Error('Approve at least one QA intent first.'));
    return;
  }
  setBusy(observeButton, true, 'Observing...');
  try {
    const payload = await postJson('/api/observe', {
      runId: state.runId,
      url: targetUrl.value.trim(),
      approvedIntents
    });
    state.observation = payload;
    renderObservation(payload);
    generateTestsButton.disabled = false;
    activateStep(2);
    updateCommandCenter('observe', 'Review observed app evidence, then generate enterprise test cases.');
    switchTab('observe');
    scrollToSection(observeSection);
  } catch (error) {
    renderError(observationPanel, error);
    updateCommandCenter('observe', 'Observation needs attention before test generation can continue.');
  } finally {
    setBusy(observeButton, false, 'Observe Approved Intents');
  }
}

async function generateTestCases() {
  const approvedIntents = collectApprovedIntents();
  setBusy(generateTestsButton, true, 'Generating...');
  try {
    const payload = await postJson('/api/test-cases', {
      runId: state.runId,
      approvedIntents,
      observation: state.observation?.observation
    });
    state.testCases = payload.testCases;
    renderTestCases(payload);
    activateStep(3);
    updateCommandCenter('tests', 'Approve business-readable test cases, then generate automation scripts.');
    switchTab('tests');
    scrollToSection(testsSection);
  } catch (error) {
    renderError(testCasesList, error);
    updateCommandCenter('tests', 'Test case generation needs attention before execution.');
  } finally {
    setBusy(generateTestsButton, false, 'Generate Test Cases');
  }
}

async function generateScripts() {
  const approvedTestCases = collectApprovedTestCases();
  if (!approvedTestCases.length) {
    renderError(scriptPanel, new Error('Approve at least one generated test case before creating scripts.'));
    return;
  }
  setBusy(generateScriptsButton, true, 'Generating...');
  try {
    const payload = await postJson('/api/scripts', {
      runId: state.runId,
      url: targetUrl.value.trim(),
      approvedTestCases
    });
    state.scriptReview = payload;
    renderScripts(payload);
    executeButton.disabled = false;
    activateStep(4);
    updateCommandCenter('scripts', 'Review the generated script summary, then approve and run scripts.');
    switchTab('scripts');
    scrollToSection(scriptsSection);
  } catch (error) {
    renderError(scriptPanel, error);
    updateCommandCenter('scripts', 'Script generation needs attention before execution.');
  } finally {
    setBusy(generateScriptsButton, false, 'Generate Scripts');
  }
}

async function executeTests() {
  if (!state.scriptReview?.generatedSpecPath) {
    renderError(evidencePanel, new Error('Generate and review scripts before execution.'));
    return;
  }
  setBusy(executeButton, true, 'Running...');
  executionStatus.textContent = 'Running';
  try {
    const payload = await postJson('/api/execute', {
      runId: state.runId,
      generatedSpecPath: state.scriptReview.generatedSpecPath,
      approvedTestCases: collectApprovedTestCases()
    });
    state.evidence = payload;
    renderEvidence(payload);
    executionStatus.textContent = payload.status;
    activateStep(5);
    updateCommandCenter('evidence', payload.releaseSummary.decision, payload.status);
    switchTab('evidence');
    scrollToSection(evidenceSection);
  } catch (error) {
    executionStatus.textContent = 'Failed';
    renderError(evidencePanel, error);
    updateCommandCenter('evidence', 'Execution failed. Review the evidence panel before demoing the result.', 'failed');
  } finally {
    setBusy(executeButton, false, 'Approve & Run Scripts');
  }
}

function renderIntents(reasoningTrace = []) {
  intentsList.className = 'item-list';
  intentsList.innerHTML = '';
  if (state.domain) {
    intentsList.append(renderDomainCard(state.domain));
  }
  const trace = renderTrace(reasoningTrace);
  intentsList.append(trace);

  const template = document.querySelector('#intent-template');
  state.intents.forEach((intent, index) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.review-item');
    if (index >= VISIBLE_REVIEW_ITEMS) {
      card.classList.add('is-collapsed');
    }
    node.querySelector('.item-title').textContent = intent.title;
    node.querySelector('.priority-select').value = intent.priority;
    node.querySelector('.item-meta').textContent = `${intent.id} | ${intent.releaseGate} | ${intent.riskLevel} risk | ${intent.flow}`;
    node.querySelector('.item-rationale').textContent = intent.rationale;
    node.querySelector('.intent-approved').dataset.id = intent.id;
    node.querySelector('.approval-status').dataset.id = intent.id;
    node.querySelector('.priority-select').dataset.id = intent.id;
    const list = node.querySelector('.criteria-list');
    intent.acceptanceCriteria.forEach(criteria => {
      const item = document.createElement('li');
      item.textContent = criteria;
      list.append(item);
    });
    intentsList.append(node);
  });
  addListToggle(intentsList, state.intents.length, 'intents');
  observeButton.disabled = false;
  updateApprovalLabels();
  updateCounts();
}

function renderObservation(payload) {
  const observation = payload.observation;
  observationPanel.className = 'evidence-grid';
  observationPanel.innerHTML = `
    ${renderTraceHtml(payload.reasoningTrace)}
    <div class="evidence-tile">
      <span>Page title</span>
      <strong>${escapeHtml(observation.title || 'Untitled')}</strong>
    </div>
    <div class="evidence-tile">
      <span>Observed controls</span>
      <strong>${observation.inputs.length} inputs, ${observation.buttons.length} buttons</strong>
    </div>
    <div class="evidence-tile">
      <span>Raw script</span>
      <a href="/${payload.rawScriptPath}" target="_blank" rel="noreferrer">${payload.rawScriptPath}</a>
    </div>
    <div class="screenshot-frame">
      <img src="${payload.screenshotPath}" alt="Observed target screenshot">
    </div>
  `;
}

function renderTestCases(payload = {}) {
  const reasoningTrace = Array.isArray(payload) ? payload : payload.reasoningTrace || [];
  testCasesList.className = 'item-list';
  testCasesList.innerHTML = '';
  testCasesList.append(renderTrace(reasoningTrace));
  if (payload.sourceLineage) {
    const lineage = renderSourceLineage(payload.sourceLineage);
    if (lineage) {
      testCasesList.append(lineage);
    }
  }

  const template = document.querySelector('#test-template');
  state.testCases.forEach((testCase, index) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.review-item');
    if (index >= VISIBLE_REVIEW_ITEMS) {
      card.classList.add('is-collapsed');
    }
    node.querySelector('.item-title').textContent = testCase.title;
    node.querySelector('.risk-badge').textContent = `${testCase.priority} | ${testCase.riskLevel}`;
    node.querySelector('.item-meta').textContent = `${testCase.id} | Intent ${testCase.businessIntentId} | ${testCase.businessFlow}`;
    node.querySelector('.test-approved').dataset.id = testCase.id;
    node.querySelector('.approval-status').dataset.id = testCase.id;
    const steps = node.querySelector('.steps-list');
    testCase.steps.forEach(step => {
      const item = document.createElement('li');
      item.textContent = step;
      steps.append(item);
    });
    node.querySelector('.expected-result').textContent = `Expected: ${testCase.expectedResult}`;
    const assertions = node.querySelector('.criteria-list');
    testCase.assertions.forEach(assertion => {
      const item = document.createElement('li');
      item.textContent = assertion;
      assertions.append(item);
    });
    const sourceIds = Array.isArray(testCase.sourceLineage) ? testCase.sourceLineage : [];
    if (sourceIds.length) {
      const details = node.querySelector('details');
      const sourceRow = document.createElement('p');
      sourceRow.className = 'source-badge-row';
      sourceRow.innerHTML = `RAG sources: ${sourceIds.map(id => `<span class="source-id">${escapeHtml(id)}</span>`).join('')}`;
      details.append(sourceRow);
    }
    testCasesList.append(node);
  });
  addListToggle(testCasesList, state.testCases.length, 'test cases');
  generateScriptsButton.disabled = false;
  updateApprovalLabels();
  updateCounts();
}

function renderScripts(payload) {
  scriptPanel.className = 'evidence-grid';
  scriptPanel.innerHTML = `
    ${renderTraceHtml(payload.reasoningTrace)}
    ${renderSourceLineageHtml(payload.sourceLineage)}
    <div class="evidence-hero">
      <span>Script approval gate</span>
      <strong>${payload.approvedTestCount} approved test cases converted to Playwright</strong>
      <p>Execution is paused until a human approves and runs the generated automation.</p>
    </div>
    <div class="evidence-tile">
      <span>Status</span>
      <strong>Pending run approval</strong>
    </div>
    <div class="evidence-tile">
      <span>Generated spec</span>
      <a href="/${payload.generatedSpecPath}" target="_blank" rel="noreferrer">${payload.generatedSpecPath}</a>
    </div>
    <div class="evidence-tile">
      <span>Script review JSON</span>
      <a href="/${payload.scriptReviewPath}" target="_blank" rel="noreferrer">${payload.scriptReviewPath}</a>
    </div>
    <pre class="script-preview">${escapeHtml(payload.scriptPreview)}</pre>
  `;
}

function renderEvidence(payload) {
  const summary = payload.releaseSummary;
  const statusClass = payload.status === 'passed' ? 'pass' : 'fail';
  evidencePanel.className = 'evidence-grid';
  evidencePanel.innerHTML = `
    <div class="evidence-hero ${statusClass}">
      <span>Release decision</span>
      <strong>${escapeHtml(summary.decision)}</strong>
      <p>${escapeHtml(summary.message)}</p>
    </div>
    ${renderTraceHtml(payload.reasoningTrace)}
    ${renderSourceLineageHtml(payload.sourceLineage)}
    <div class="evidence-tile ${statusClass}">
      <span>Status</span>
      <strong>${escapeHtml(payload.status)}</strong>
    </div>
    <div class="evidence-tile">
      <span>Decision</span>
      <strong>${escapeHtml(summary.decision)}</strong>
    </div>
    <div class="evidence-tile">
      <span>Approved tests</span>
      <strong>${summary.approvedTests}</strong>
    </div>
    <div class="evidence-tile">
      <span>Spec file</span>
      <a href="/${payload.generatedSpecPath}" target="_blank" rel="noreferrer">${payload.generatedSpecPath}</a>
    </div>
    <div class="evidence-tile">
      <span>Evidence JSON</span>
      <a href="/${payload.evidencePath}" target="_blank" rel="noreferrer">${payload.evidencePath}</a>
    </div>
    <div class="evidence-tile">
      <span>User sign-off report</span>
      <a href="/${payload.signoffReportHtmlPath}" target="_blank" rel="noreferrer">${payload.signoffReportHtmlPath}</a>
    </div>
    <div class="evidence-tile">
      <span>Markdown report</span>
      <a href="/${payload.signoffReportMarkdownPath}" target="_blank" rel="noreferrer">${payload.signoffReportMarkdownPath}</a>
    </div>
    <pre class="console-output">${escapeHtml(summary.message)}</pre>
  `;
}

function collectApprovedIntents() {
  return state.intents.map(intent => {
    const checkbox = document.querySelector(`.intent-approved[data-id="${cssEscape(intent.id)}"]`);
    const priority = document.querySelector(`.priority-select[data-id="${cssEscape(intent.id)}"]`);
    return {
      ...intent,
      priority: priority?.value || intent.priority,
      reviewerStatus: checkbox?.checked ? 'approved' : 'rejected'
    };
  }).filter(intent => intent.reviewerStatus === 'approved');
}

function collectApprovedTestCases() {
  return state.testCases.map(testCase => {
    const checkbox = document.querySelector(`.test-approved[data-id="${cssEscape(testCase.id)}"]`);
    return {
      ...testCase,
      reviewerStatus: checkbox?.checked ? 'approved' : 'rejected'
    };
  }).filter(testCase => testCase.reviewerStatus === 'approved');
}

function resetAfterIntent() {
  state.runId = null;
  state.domain = null;
  state.intents = [];
  state.observation = null;
  state.testCases = [];
  state.scriptReview = null;
  state.evidence = null;
  observeButton.disabled = true;
  generateTestsButton.disabled = true;
  generateScriptsButton.disabled = true;
  executeButton.disabled = true;
  executionStatus.textContent = 'Waiting';
  observationPanel.className = 'evidence-grid empty-state';
  observationPanel.textContent = 'Observation details will appear here.';
  testCasesList.className = 'item-list empty-state';
  testCasesList.textContent = 'Generated test cases will appear here.';
  scriptPanel.className = 'evidence-grid empty-state';
  scriptPanel.textContent = 'Approved test cases will be converted into scripts here.';
  evidencePanel.className = 'evidence-grid empty-state';
  evidencePanel.textContent = 'Pass/fail evidence will appear here.';
  updateCounts();
  updateCommandCenter('intent', 'Enter a target URL and release intent, then generate QA intents.');
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function setBusy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = label;
}

function updateCounts() {
  const approvedIntents = collectApprovedIntents().length;
  const approvedTests = collectApprovedTestCases().length;
  intentCount.textContent = approvedIntents;
  testCount.textContent = approvedTests;
  approvedIntentsMetric.textContent = approvedIntents;
  approvedTestsMetric.textContent = approvedTests;
  targetMetric.textContent = summarizeTarget(targetUrl.value);
  domainMetric.textContent = state.domain ? `${state.domain.name} (${state.domain.confidence})` : 'Not detected';
}

function updateApprovalLabels() {
  document.querySelectorAll('.intent-approved,.test-approved').forEach(checkbox => {
    const item = checkbox.closest('.review-item');
    const status = item?.querySelector('.approval-status');
    const action = item?.querySelector('.approval-action');
    if (!status || !action) {
      return;
    }
    const isApproved = checkbox.checked;
    status.textContent = isApproved ? 'Approved' : 'Rejected';
    action.textContent = isApproved ? 'Approve' : 'Reject';
    status.classList.toggle('approved', isApproved);
    status.classList.toggle('rejected', !isApproved);
  });
}

function activateStep(step) {
  document.querySelectorAll('.step').forEach(item => {
    item.classList.toggle('active', Number(item.dataset.step) <= step);
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
  document.querySelectorAll('.step[data-tab]').forEach(tabButton => {
    const selected = tabButton.dataset.tab === tabName;
    tabButton.classList.toggle('selected', selected);
    tabButton.setAttribute('aria-selected', String(selected));
  });
}

function updateCommandCenter(stage, message, status = null) {
  const headlineByStage = {
    intent: state.intents.length ? 'QA intents ready for human approval' : 'Ready to generate release coverage',
    observe: 'Application observed with Playwright',
    tests: 'Enterprise test cases ready for review',
    scripts: 'Automation scripts ready for approval',
    evidence: status === 'passed' ? 'Demo-ready evidence captured' : 'Execution evidence needs review'
  };
  decisionHeadline.textContent = headlineByStage[stage] || headlineByStage.intent;
  nextAction.textContent = message;
  if (status) {
    decisionMetric.textContent = status === 'passed' ? 'Demo-ready' : 'Review needed';
    decisionMetric.className = status === 'passed' ? 'metric-pass' : 'metric-fail';
  } else {
    decisionMetric.textContent = stage === 'intent' && !state.intents.length ? 'Waiting' : 'In progress';
    decisionMetric.className = '';
  }
  updateActivityTimeline(stage, status);
  updateCounts();
}

function updateActivityTimeline(stage, status) {
  const order = ['intent', 'observe', 'tests', 'scripts', 'evidence'];
  const currentIndex = order.indexOf(stage);
  activityTimeline.querySelectorAll('li').forEach(item => {
    const itemIndex = order.indexOf(item.dataset.stage);
    item.className = '';
    if (status === 'passed') {
      item.classList.add('done');
      return;
    }
    if (itemIndex < currentIndex) {
      item.classList.add('done');
    } else if (itemIndex === currentIndex) {
      item.classList.add('current');
    }
  });
}

function addListToggle(container, totalCount, label) {
  if (totalCount <= VISIBLE_REVIEW_ITEMS) {
    return;
  }
  const hiddenCount = totalCount - VISIBLE_REVIEW_ITEMS;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'show-more-button';
  button.textContent = `Show ${hiddenCount} more ${label}`;
  button.addEventListener('click', () => {
    const collapsed = Array.from(container.querySelectorAll('.review-item.is-collapsed'));
    const isExpanded = collapsed.length === 0;
    if (isExpanded) {
      Array.from(container.querySelectorAll('.review-item')).forEach((item, index) => {
        item.classList.toggle('is-collapsed', index >= VISIBLE_REVIEW_ITEMS);
      });
      button.textContent = `Show ${hiddenCount} more ${label}`;
    } else {
      collapsed.forEach(item => item.classList.remove('is-collapsed'));
      button.textContent = `Show fewer ${label}`;
    }
  });
  container.append(button);
}

function scrollToSection(section) {
  window.requestAnimationFrame(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function summarizeTarget(value) {
  try {
    const url = new URL(value);
    if (url.pathname.includes('demo-fintech')) {
      return 'Demo fintech app';
    }
    return url.hostname;
  } catch (_error) {
    return 'Not set';
  }
}

function renderTrace(trace = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'reasoning-trace';
  wrapper.innerHTML = '<strong>Reasoning trace</strong>';
  const list = document.createElement('ul');
  trace.forEach(line => {
    const item = document.createElement('li');
    item.textContent = line;
    list.append(item);
  });
  wrapper.append(list);
  return wrapper;
}

function renderDomainCard(domain) {
  const wrapper = document.createElement('div');
  wrapper.className = 'domain-card';
  wrapper.innerHTML = `
    <div>
      <span>Domain Agent</span>
      <strong>${escapeHtml(domain.name)} detected</strong>
      <p>${escapeHtml(domain.rationale || 'Detected from URL and release intent.')}</p>
    </div>
    <div class="domain-signals">
      <span>Confidence: ${escapeHtml(domain.confidence || 'Medium')}</span>
      <p>${escapeHtml((domain.signals || []).join(', ') || 'release intent, target URL')}</p>
    </div>
  `;
  return wrapper;
}

function renderSourceLineage(lineage) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderSourceLineageHtml(lineage);
  return wrapper.firstElementChild;
}

function renderSourceLineageHtml(lineage) {
  const groups = getLineageGroups(lineage);
  if (!groups.length) {
    return '';
  }

  return `
    <div class="source-lineage">
      <div class="source-lineage-head">
        <span>FAISS RAG lineage</span>
        <strong>Guidelines used to generate this output</strong>
      </div>
      <div class="source-lineage-grid">
        ${groups.map(group => group.chunks.map(chunk => `
          <article class="source-card">
            <span class="source-id">${escapeHtml(chunk.id)}</span>
            <strong>${escapeHtml(chunk.title)}</strong>
            <p>${escapeHtml(chunk.excerpt || chunk.text || '')}</p>
            <small>${escapeHtml(chunk.source || 'rag/guidelines.json')} | score ${escapeHtml(chunk.score ?? 'n/a')}</small>
          </article>
        `).join('')).join('')}
      </div>
    </div>
  `;
}

function getLineageGroups(lineage) {
  if (!lineage) {
    return [];
  }
  if (Array.isArray(lineage.chunks) && lineage.chunks.length) {
    const label = lineage.kind === 'test-script' ? 'Script RAG' : 'Test Case RAG';
    return [{ label, chunks: lineage.chunks }];
  }

  const groups = [];
  if (lineage.testCases?.chunks?.length) {
    groups.push({ label: 'Test Case RAG', chunks: lineage.testCases.chunks });
  }
  if (lineage.testScripts?.chunks?.length) {
    groups.push({ label: 'Script RAG', chunks: lineage.testScripts.chunks });
  }
  return groups;
}

function renderTraceHtml(trace = []) {
  return `
    <div class="reasoning-trace">
      <strong>Reasoning trace</strong>
      <ul>${trace.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    </div>
  `;
}

function renderError(container, error) {
  container.className = container.className.replace('empty-state', '').trim();
  container.innerHTML = `<div class="error-box">${escapeHtml(error.message || String(error))}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

document.addEventListener('change', event => {
  if (event.target.matches('.intent-approved,.test-approved,.priority-select')) {
    updateApprovalLabels();
    updateCounts();
  }
});

targetUrl.addEventListener('input', () => {
  syncTargetSuggestionState();
  updateCounts();
});
