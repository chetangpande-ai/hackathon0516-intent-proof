const state = {
  accountCreated: false,
  kycSubmitted: false,
  fraudChecked: false,
  paymentComplete: false,
  balance: 10000
};

const money = new Intl.NumberFormat('en-IN');

const get = testId => document.querySelector(`[data-testid="${testId}"]`);

get('account-continue').addEventListener('click', () => {
  if (!get('full-name').value || !get('email').value || !get('phone').value) {
    get('account-status').textContent = 'Complete all account fields';
    return;
  }
  state.accountCreated = true;
  get('account-status').textContent = 'Account created';
  get('kyc-panel').classList.remove('locked');
  get('kyc-status').textContent = 'KYC ready for submission';
  addNotification('Account created for KYC onboarding');
});

get('kyc-continue').addEventListener('click', () => {
  if (!state.accountCreated) {
    get('kyc-status').textContent = 'Create account before KYC';
    return;
  }
  if (!get('pan').value || !get('identity-id').value) {
    get('kyc-status').textContent = 'Complete KYC identity details';
    return;
  }
  state.kycSubmitted = true;
  get('kyc-status').textContent = 'KYC approved for demo';
  get('payment-panel').classList.remove('locked');
  addNotification('KYC approved for payment activation');
});

get('fraud-check').addEventListener('click', () => {
  if (!state.kycSubmitted) {
    get('fraud-status').textContent = 'KYC must be approved before fraud check';
    return;
  }
  state.fraudChecked = true;
  get('fraud-status').textContent = 'Low risk, shadow decision recorded';
  addNotification('AI fraud check completed in shadow mode');
});

get('payment-submit').addEventListener('click', () => {
  if (!state.fraudChecked) {
    get('payment-status').textContent = 'Run fraud check before payment';
    return;
  }
  const amount = Number(get('amount').value || 0);
  if (!amount || !get('payee').value) {
    get('payment-status').textContent = 'Enter payment amount and payee';
    return;
  }
  if (state.paymentComplete) {
    get('payment-status').textContent = 'Duplicate payment prevented';
    return;
  }
  state.paymentComplete = true;
  state.balance += amount;
  get('wallet-balance').textContent = `₹${money.format(state.balance)}`;
  get('payment-status').textContent = 'Payment complete';
  get('release-status').textContent = 'Payment complete';
  addNotification(`Payment of ₹${money.format(amount)} completed`);
});

get('refund-button').addEventListener('click', () => {
  if (!state.paymentComplete) {
    get('refund-status').textContent = 'No eligible transaction for refund';
    return;
  }
  get('refund-status').textContent = 'Refund initiated';
  get('release-status').textContent = 'Refund initiated';
  addNotification('Refund initiated for latest payment');
});

function addNotification(message) {
  const item = document.createElement('li');
  item.textContent = message;
  get('notification-list').prepend(item);
}
